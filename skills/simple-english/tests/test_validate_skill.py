import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "validate_skill.py"
SPEC = importlib.util.spec_from_file_location("validate_skill", SCRIPT)
assert SPEC and SPEC.loader
validate_skill = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validate_skill)


class ValidateSkillTests(unittest.TestCase):
    def test_current_skill_passes(self):
        root = Path(__file__).resolve().parents[1]
        errors, warnings = validate_skill.validate(root)
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])

    def test_top_level_version_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "bad-skill"
            root.mkdir()
            (root / "SKILL.md").write_text(
                "---\n"
                "name: bad-skill\n"
                "description: Use this skill when testing invalid metadata.\n"
                "version: 1.0.0\n"
                "---\n\n# Bad skill\n",
                encoding="utf-8",
            )
            errors, _ = validate_skill.validate(root)
            self.assertTrue(any("unsupported top-level" in item for item in errors), errors)

    def test_broken_relative_reference_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "test-skill"
            root.mkdir()
            (root / "SKILL.md").write_text(
                "---\n"
                "name: test-skill\n"
                "description: Use this skill when testing references.\n"
                "---\n\n"
                "Read [the missing guide](references/missing.md).\n",
                encoding="utf-8",
            )
            errors, _ = validate_skill.validate(root)
            self.assertIn("missing referenced file: references/missing.md", errors)


if __name__ == "__main__":
    unittest.main()
