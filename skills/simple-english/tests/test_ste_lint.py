import importlib.util
import json
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "ste_lint.py"
SPEC = importlib.util.spec_from_file_location("ste_lint", SCRIPT)
assert SPEC and SPEC.loader
ste_lint = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ste_lint
SPEC.loader.exec_module(ste_lint)


class SteLintTests(unittest.TestCase):
    def test_strict_long_procedure_is_error(self):
        text = (
            "Install the package and record the complete deployment identifier in the operations log "
            "before you restart the production service safely later today."
        )
        report = ste_lint.lint_text(text, "procedural", strict=True)
        self.assertGreaterEqual(report["summary"]["by_severity"]["error"], 1)
        self.assertIn("SENTENCE_LENGTH", {item["code"] for item in report["findings"]})

    def test_trailing_condition_is_review_not_automatic_error(self):
        report = ste_lint.lint_text(
            "Record the response code when the request fails.", "procedural", strict=True
        )
        finding = next(item for item in report["findings"] if item["code"] == "CONDITION_ORDER_REVIEW")
        self.assertEqual(finding["severity"], "review")
        self.assertEqual(report["summary"]["by_severity"]["error"], 0)

    def test_fenced_code_is_ignored(self):
        text = "```bash\nthis isn't prose; it should stay exact\n```\nRun `deploy --force`."
        report = ste_lint.lint_text(text, "procedural", strict=True)
        codes = {item["code"] for item in report["findings"]}
        self.assertNotIn("CONTRACTION", codes)
        self.assertNotIn("SEMICOLON", codes)

    def test_note_is_classified_separately(self):
        blocks = ste_lint.extract_blocks(
            "1. Restart the service.\n\nNOTE: The cache stores results for five minutes.", "mixed"
        )
        self.assertEqual([block.kind for block in blocks], ["procedural", "note"])


    def test_note_instruction_is_review_candidate(self):
        report = ste_lint.lint_text("NOTE: Restart the worker after this.", "mixed", strict=True)
        codes = {item["code"] for item in report["findings"]}
        self.assertIn("NOTE_INSTRUCTION_CANDIDATE", codes)

    def test_modal_is_meaning_review(self):
        report = ste_lint.lint_text("Administrators may reset the token.", "descriptive", strict=True)
        finding = next(item for item in report["findings"] if item["code"] == "MODAL_MEANING_REVIEW")
        self.assertEqual(finding["severity"], "review")

    def test_inline_literal_counts_as_one_word(self):
        self.assertEqual(ste_lint.count_words("Run `a very long command --with flags` now."), 3)

    def test_term_variation_is_candidate(self):
        report = ste_lint.lint_text(
            "Check the file. Then verify the result.", "procedural", strict=False
        )
        finding = next(item for item in report["findings"] if item["code"] == "TERM_VARIATION_CANDIDATE")
        self.assertEqual(finding["severity"], "review")

    def test_report_is_json_serializable(self):
        report = ste_lint.lint_text("Run the test.", "procedural", strict=True)
        json.dumps(report)


if __name__ == "__main__":
    unittest.main()
