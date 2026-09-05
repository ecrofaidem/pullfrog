#!/usr/bin/env python3
"""Validate the local Simple English skill with Python's standard library.

This validator checks the portable Agent Skills structure and project-specific
invariants. Use the official `skills-ref validate` command as an additional
validation step when it is installed.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Sequence

ALLOWED_TOP_LEVEL = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
CODE_PATH_RE = re.compile(r"`((?:references|scripts|assets)/[^`\s]+)`")


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1]
    return value.replace('\\"', '"')


def parse_frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---\n"):
        raise ValueError("SKILL.md must start with YAML frontmatter")
    end = text.find("\n---\n", 4)
    if end == -1:
        raise ValueError("SKILL.md frontmatter has no closing --- line")

    raw = text[4:end]
    body = text[end + 5 :]
    data: dict[str, object] = {}
    current_map: str | None = None

    for line_number, line in enumerate(raw.splitlines(), start=2):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        if indent == 0:
            match = re.match(r"^([A-Za-z0-9_-]+):(?:\s*(.*))?$", line)
            if not match:
                raise ValueError(f"unsupported frontmatter syntax on line {line_number}: {line}")
            key, value = match.group(1), match.group(2) or ""
            if not value:
                data[key] = {}
                current_map = key
            else:
                data[key] = _unquote(value)
                current_map = None
        else:
            if indent != 2 or current_map is None or not isinstance(data.get(current_map), dict):
                raise ValueError(f"unsupported nested frontmatter syntax on line {line_number}: {line}")
            match = re.match(r"^\s{2}([A-Za-z0-9_-]+):\s*(.+)$", line)
            if not match:
                raise ValueError(f"unsupported metadata syntax on line {line_number}: {line}")
            data[current_map][match.group(1)] = _unquote(match.group(2))

    return data, body


def validate(root: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    skill_file = root / "SKILL.md"
    if not skill_file.is_file():
        return [f"missing {skill_file}"], warnings

    try:
        text = skill_file.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [f"cannot read {skill_file}: {exc}"], warnings

    try:
        frontmatter, body = parse_frontmatter(text)
    except ValueError as exc:
        return [str(exc)], warnings

    unknown = sorted(set(frontmatter) - ALLOWED_TOP_LEVEL)
    if unknown:
        errors.append(f"unsupported top-level frontmatter keys: {', '.join(unknown)}")

    for required in ("name", "description"):
        if not isinstance(frontmatter.get(required), str) or not str(frontmatter[required]).strip():
            errors.append(f"missing or empty required field: {required}")

    name = str(frontmatter.get("name", ""))
    if name:
        if len(name) > 64:
            errors.append("name exceeds 64 characters")
        if not NAME_RE.fullmatch(name) or "--" in name:
            errors.append("name must contain lowercase letters, numbers, and single hyphens only")
        if root.name != name:
            errors.append(f"name '{name}' does not match parent directory '{root.name}'")

    description = str(frontmatter.get("description", ""))
    if len(description) > 1024:
        errors.append(f"description has {len(description)} characters; maximum is 1024")
    if description and not re.search(r"\b(use|apply|when)\b", description, re.IGNORECASE):
        warnings.append("description might not state when to use the skill")

    metadata = frontmatter.get("metadata")
    if metadata is not None:
        if not isinstance(metadata, dict):
            errors.append("metadata must be a map")
        else:
            for key, value in metadata.items():
                if not isinstance(key, str) or not isinstance(value, str):
                    errors.append("metadata keys and values must be strings")
                    break

    lines = text.splitlines()
    if len(lines) >= 500:
        warnings.append(f"SKILL.md has {len(lines)} lines; keep it under 500")
    token_estimate = max(1, round(len(body) / 4))
    if token_estimate >= 5000:
        warnings.append(f"SKILL.md body is approximately {token_estimate} tokens; target is under 5000")

    referenced: set[str] = set()
    for target in LINK_RE.findall(body):
        target = target.strip().split("#", 1)[0]
        if target and not re.match(r"^(?:https?://|mailto:|#)", target):
            referenced.add(target)
    referenced.update(CODE_PATH_RE.findall(body))

    for relative in sorted(referenced):
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts:
            errors.append(f"unsafe file reference: {relative}")
            continue
        if len(path.parts) > 2:
            warnings.append(f"deep file reference reduces progressive disclosure: {relative}")
        if not (root / path).exists():
            errors.append(f"missing referenced file: {relative}")

    forbidden_pdfs = list(root.rglob("*ASD*STE100*.pdf")) + list(root.rglob("*ASD-STE100*.pdf"))
    if forbidden_pdfs:
        errors.append("do not bundle the official ASD-STE100 PDF; follow its distribution terms")

    for script in (root / "scripts").glob("*.py") if (root / "scripts").is_dir() else []:
        try:
            compile(script.read_text(encoding="utf-8"), str(script), "exec")
        except (OSError, UnicodeDecodeError, SyntaxError) as exc:
            errors.append(f"invalid Python script {script.relative_to(root)}: {exc}")

    return errors, warnings


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skill_root", nargs="?", default=Path(__file__).resolve().parents[1])
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root = Path(args.skill_root).resolve()
    errors, warnings = validate(root)
    for item in warnings:
        print(f"WARNING: {item}")
    for item in errors:
        print(f"ERROR: {item}")
    if errors:
        print(f"Validation failed: {len(errors)} error(s), {len(warnings)} warning(s).")
        return 1
    print(f"Validation passed: {root} ({len(warnings)} warning(s)).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
