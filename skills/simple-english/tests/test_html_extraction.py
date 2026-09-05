import importlib.util
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "ste_lint.py"
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "html-mixed-content.html"
SPEC = importlib.util.spec_from_file_location("ste_lint_v3_html", SCRIPT)
assert SPEC and SPEC.loader
ste_lint = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ste_lint
SPEC.loader.exec_module(ste_lint)


class HtmlExtractionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = FIXTURE.read_text(encoding="utf-8")
        cls.extraction = ste_lint.extract_document(cls.text, "mixed", input_format="html")
        cls.report = ste_lint.lint_extraction(cls.extraction, "mixed", strict=True)

    def test_markup_css_script_and_geometry_never_reach_findings(self):
        excerpts = "\n".join(x["excerpt"] for x in self.report["findings"])
        for pattern in (r"font-family\s*:", r"fill\s*:", r"stroke\s*:", r"viewBox", r"\bd=", r"const message", r"<path", r"<style"):
            self.assertIsNone(re.search(pattern, excerpts, re.I), pattern)

    def test_exclusion_counts(self):
        e = self.extraction.details["excluded"]
        self.assertEqual(e["style_subtrees_excluded"], 2)
        self.assertEqual(e["script_subtrees_excluded"], 1)
        self.assertEqual(e["pre_subtrees_excluded"], 1)
        self.assertEqual(e["svg_defs_subtrees_excluded"], 1)
        self.assertGreaterEqual(e["svg_implementation_elements_excluded"], 1)

    def test_svg_description_has_full_profile(self):
        findings = [x for x in self.report["findings"] if x["source"] == "svg-desc"]
        self.assertIn("SENTENCE_LENGTH", {x["code"] for x in findings})
        self.assertTrue(all(x["content_form"] == "accessibility-description" for x in findings))

    def test_svg_labels_are_separate_and_lightweight(self):
        labels = [b for b in self.extraction.blocks if b.source == "svg-text"]
        self.assertEqual(len(labels), 3)
        self.assertEqual(labels[0].text, "derive; seeded splits;")
        findings = [x for x in self.report["findings"] if x["source"] == "svg-text" and x["content_form"] == "label"]
        self.assertNotIn("SEMICOLON", {x["code"] for x in findings})
        self.assertNotIn("PASSIVE_VOICE_CANDIDATE", {x["code"] for x in findings})

    def test_form_override_promotes_svg_text_to_prose(self):
        block = next(b for b in self.extraction.blocks if b.source == "svg-text" and b.text.startswith("Restart"))
        self.assertEqual(block.content_form, "prose")
        findings = [x for x in self.report["findings"] if x["source"] == "svg-text" and x["line"] == block.start_line]
        self.assertIn("SEMICOLON", {x["code"] for x in findings})

    def test_non_english_hidden_and_ignore_are_excluded(self):
        text = "\n".join(b.text for b in self.extraction.blocks)
        for excluded in ("Der Dienst", "Dieser Text", "This hidden", "This CSS-hidden", "This ignored"):
            self.assertNotIn(excluded, text)
        e = self.extraction.details["excluded"]
        self.assertGreaterEqual(e["non_english_blocks_excluded"], 1)
        self.assertGreaterEqual(e["hidden_subtrees_excluded"], 2)
        self.assertEqual(e["explicit_ste_ignore_subtrees_excluded"], 1)

    def test_inline_code_is_fixed(self):
        block = next(b for b in self.extraction.blocks if "deploy;" in b.text)
        self.assertIn("`deploy; this isn't prose`", block.text)
        self.assertEqual(ste_lint.count_words(block.text), 3)
        findings = [x for x in self.report["findings"] if x["line"] == block.start_line]
        self.assertNotIn("SEMICOLON", {x["code"] for x in findings})
        self.assertNotIn("CONTRACTION", {x["code"] for x in findings})

    def test_accessibility_forms(self):
        self.assertEqual(next(b for b in self.extraction.blocks if b.source == "html-alt").content_form, "accessibility-label")
        self.assertEqual(next(b for b in self.extraction.blocks if b.source == "html-aria-description").content_form, "accessibility-description")

    def test_duplicate_visible_and_aria_label_is_collapsed(self):
        matches = [b for b in self.extraction.blocks if b.text == "Save changes"]
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].source, "html-button")
        self.assertEqual(self.extraction.details["excluded"]["duplicate_blocks_collapsed"], 1)

    def test_findings_have_dom_locations(self):
        for finding in self.report["findings"]:
            if finding["source"] != "document":
                self.assertGreater(finding["line"], 0)
                self.assertTrue("#" in finding["location"] or ":nth-of-type(" in finding["location"])

    def test_headings_are_optional(self):
        self.assertFalse(any(b.source == "html-h1" for b in self.extraction.blocks))
        with_headings = ste_lint.extract_document(self.text, "mixed", input_format="html", include_headings=True)
        self.assertEqual([b.text for b in with_headings.blocks if b.source == "html-h1"], ["System overview"])

    def test_skip_svg_labels_keeps_accessibility(self):
        x = ste_lint.extract_document(self.text, "mixed", input_format="html", include_svg_labels=False)
        self.assertFalse(any(b.source == "svg-text" for b in x.blocks))
        self.assertTrue(any(b.source == "svg-title" for b in x.blocks))
        self.assertTrue(any(b.source == "svg-desc" for b in x.blocks))

    def test_standalone_labels_and_input_values_are_kept(self):
        by_text = {b.text: b for b in self.extraction.blocks}
        self.assertEqual(by_text["Skip to content"].source, "html-a")
        self.assertEqual(by_text["Validated: backed by a test run"].source, "html-span")
        self.assertEqual(by_text["Open: not yet validated"].source, "html-span")
        self.assertEqual(by_text["Run audit"].source, "html-input-value")

    def test_inline_elements_keep_word_boundaries_without_duplicate_blocks(self):
        texts = [b.text for b in self.extraction.blocks]
        self.assertIn("CLI capture reads the account.", texts)
        self.assertIn("Open the status page now.", texts)
        self.assertNotIn("the status page", texts)

    def test_json_serializable(self):
        json.dumps(self.report)


class FormatDetectionTests(unittest.TestCase):
    def test_detects_html_markdown_and_text(self):
        self.assertEqual(ste_lint._detect_input_format("x.bin", "<!doctype html><html></html>", "auto"), "html")
        self.assertEqual(ste_lint._detect_input_format("README.md", "# Title", "auto"), "markdown")
        self.assertEqual(ste_lint._detect_input_format("notes.txt", "Plain", "auto"), "text")
        self.assertEqual(ste_lint._detect_input_format("diagram.svg", "<svg></svg>", "auto"), "svg")
        self.assertEqual(ste_lint._detect_input_format("x.bin", "<svg viewBox='0 0 1 1'></svg>", "auto"), "svg")

    def test_standalone_svg_uses_the_structured_adapter(self):
        source = "<svg xml:lang='en'><style>.x{fill:red}</style><desc>A useful description.</desc><text>Node label</text><path d='M0 0'/></svg>"
        extraction = ste_lint.extract_document(source, "mixed", input_format="svg")
        self.assertEqual([b.source for b in extraction.blocks], ["svg-desc", "svg-text"])
        self.assertEqual(extraction.input_format, "svg")


if __name__ == "__main__":
    unittest.main()
