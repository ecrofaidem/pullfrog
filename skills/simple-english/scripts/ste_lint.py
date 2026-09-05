#!/usr/bin/env python3
"""Format-aware heuristic checker for STE-oriented technical writing.

The checker separates source extraction from language review. It supports plain
text, Markdown, static HTML, and standalone SVG. For HTML and SVG, it excludes implementation markup,
CSS, scripts, SVG geometry, hidden subtrees, and non-English blocks before it
applies sentence heuristics. It keeps human-facing prose, accessibility
content, and labels in separate profiles.

This tool does not check the official ASD-STE100 dictionary, a project glossary,
technical accuracy, semantic fidelity, or compliance.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import asdict, dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable, Sequence

VERSION = "3.0.0"
STRICT_LIMITS = {"procedural": 20, "descriptive": 25, "note": 25, "safety": 20}
LABEL_WORD_LIMIT = 20

HEADING_PROCEDURAL = re.compile(
    r"\b(procedure|procedures|steps|instructions|installation|configuration|migration|"
    r"runbook|playbook|troubleshooting|recovery|rollback|setup)\b", re.I
)
HEADING_DESCRIPTIVE = re.compile(
    r"\b(overview|description|architecture|background|summary|concepts|incident|"
    r"postmortem|reference|design|behavior|behaviour)\b", re.I
)
IMPERATIVE_VERBS = {
    "add", "apply", "attach", "back", "backup", "build", "change", "check", "choose",
    "clean", "click", "close", "compare", "configure", "connect", "copy", "create",
    "delete", "deploy", "disable", "disconnect", "download", "edit", "enable", "enter",
    "execute", "export", "find", "get", "go", "identify", "import", "install", "keep",
    "load", "log", "make", "measure", "move", "open", "press", "push", "read", "record",
    "remove", "replace", "restart", "restore", "retry", "return", "review", "rotate", "run",
    "save", "select", "send", "set", "start", "stop", "submit", "test", "turn", "type",
    "uninstall", "update", "upload", "use", "validate", "verify", "wait", "write",
}
CONTRACTION_RE = re.compile(
    r"\b(?:I['’]m|(?:you|we|they)['’]re|(?:I|you|we|they)['’]ve|"
    r"(?:I|you|he|she|we|they|it|that|there|this|what|who|where|when|why|how)['’](?:ll|d)|"
    r"(?:it|he|she|that|there|this|what|who|where|when|why|how)['’]s|[A-Za-z]+n['’]t)\b", re.I
)
MODAL_RE = re.compile(r"\b(should|would|may|might|could|shall)\b", re.I)
LATIN_RE = re.compile(r"\b(e\.g\.|i\.e\.|etc\.?)", re.I)
PERFECT_RE = re.compile(
    r"\b(has|have|had)\s+(?:not\s+)?(?:been\s+)?(?:[A-Za-z]+(?:ed|en)|been|built|done|"
    r"found|given|gone|kept|known|made|put|read|run|seen|sent|set|shown|taken|written)\b", re.I
)
PROGRESSIVE_RE = re.compile(r"\b(am|is|are|was|were|be|been|being)\s+(?:not\s+)?[A-Za-z]+ing\b", re.I)
PASSIVE_RE = re.compile(
    r"\b(am|is|are|was|were|be|been|being)\s+(?:not\s+)?(?:[A-Za-z]+(?:ed|en)|built|done|"
    r"found|given|kept|known|made|put|read|run|seen|sent|set|shown|taken|written)\b", re.I
)
ING_CLAUSE_RE = re.compile(r",\s*(?:by\s+)?[A-Za-z]+ing\b", re.I)
CONDITION_RE = re.compile(r"\b(if|when|unless|after|before)\b", re.I)
FILLER_RE = re.compile(
    r"\b(simply|seamlessly|effortlessly|robust|powerful|comprehensive|leverage|leveraging|"
    r"utilize|utilizing|crucial|pivotal|streamlined)\b", re.I
)
TERM_GROUPS = {
    "check": {"check", "verify", "confirm", "validate"},
    "configuration": {"config", "configuration", "settings"},
    "run": {"run", "execute"},
    "start": {"start", "begin", "initiate"},
}
FENCE_RE = re.compile(r"^\s*(```|~~~)")
HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*$")
LIST_RE = re.compile(r"^\s*(?P<marker>(?:[-+*])|(?:\d+[.)]))\s+(?P<body>.*)$")
TABLE_DIVIDER_RE = re.compile(r"^\s*\|?\s*:?-{3,}")
NOTE_RE = re.compile(r"^\s*(?:\*\*)?NOTE(?:\*\*)?\s*:\s*", re.I)
SAFETY_RE = re.compile(r"^\s*(?:\*\*)?(WARNING|CAUTION|DANGER|NOTICE)(?:\*\*)?\s*:\s*", re.I)
FULL_PROSE_FORMS = {"prose", "accessibility-description"}
LABEL_FORMS = {"label", "accessibility-label"}
VALID_FORMS = FULL_PROSE_FORMS | LABEL_FORMS | {"literal"}
VALID_TYPES = {"procedural", "descriptive", "note", "safety"}


@dataclass(frozen=True)
class Block:
    text: str
    start_line: int
    kind: str
    source: str
    content_form: str = "prose"
    location: str = ""
    language: str = "en"


@dataclass(frozen=True)
class Finding:
    code: str
    severity: str
    category: str
    line: int
    block_type: str
    content_form: str
    source: str
    location: str
    message: str
    excerpt: str


@dataclass(frozen=True)
class ExtractionResult:
    input_format: str
    blocks: list[Block]
    details: dict


HTML_PROSE_TAGS = {"p", "li", "dd", "figcaption", "blockquote", "textarea"}
HTML_LABEL_TAGS = {"a", "span", "small", "dt", "caption", "th", "summary", "label", "button", "legend", "option", "output"}
HTML_HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
HTML_SKIP_TAGS = {"script", "style", "template", "noscript", "pre", "math"}
HTML_LITERAL_TAGS = {"code", "kbd", "samp", "var"}
HTML_VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
    "param", "source", "track", "wbr",
}
A11Y_ATTRS = {
    "aria-label": "accessibility-label", "alt": "accessibility-label",
    "placeholder": "accessibility-label", "title": "accessibility-label",
    "aria-description": "accessibility-description",
}
SVG_SKIP_SUBTREES = {"defs", "metadata", "symbol", "marker", "pattern"}
SVG_IMPLEMENTATION_TAGS = {
    "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "use", "image",
    "clippath", "mask", "lineargradient", "radialgradient", "stop", "filter", "feblend",
    "fecolormatrix", "fecomponenttransfer", "fecomposite", "feconvolvematrix",
    "fediffuselighting", "fedisplacementmap", "fedropshadow", "feflood", "fegaussianblur",
    "feimage", "femerge", "femorphology", "feoffset", "fespecularlighting", "fetile", "feturbulence",
}


@dataclass
class _Capture:
    tag: str
    line: int
    source: str
    section_hint: str | None
    path: str
    language: str
    form: str
    type_override: str | None
    parts: list[str] = field(default_factory=list)
    heading: bool = False


@dataclass
class _Frame:
    tag: str
    path_parts: tuple[str, ...]
    ignored: bool
    lang: str | None
    in_svg: bool
    child_counts: Counter[str] = field(default_factory=Counter)
    capture: _Capture | None = None
    literal_opened: bool = False


def _lang_is_english(lang: str | None) -> bool:
    if not lang:
        return True
    value = lang.strip().lower().replace("_", "-")
    return value == "en" or value.startswith("en-")


def _norm_lang(lang: str | None) -> str:
    return (lang or "en").strip().lower().replace("_", "-")


class _HTMLExtractor(HTMLParser):
    def __init__(self, requested: str, include_accessibility: bool, include_svg_labels: bool, include_headings: bool):
        super().__init__(convert_charrefs=True)
        self.requested = requested
        self.include_accessibility = include_accessibility
        self.include_svg_labels = include_svg_labels
        self.include_headings = include_headings
        self.frames: list[_Frame] = []
        self.root_counts: Counter[str] = Counter()
        self.blocks: list[Block] = []
        self.section_hint: str | None = None
        self.stats: Counter[str] = Counter()
        self.warnings: list[str] = []

    def _parent(self) -> _Frame | None:
        return self.frames[-1] if self.frames else None

    def _active_capture(self, omit_top: bool = False) -> _Capture | None:
        frames = self.frames[:-1] if omit_top else self.frames
        for frame in reversed(frames):
            if frame.capture:
                return frame.capture
        return None

    def _boundary(self) -> None:
        cap = self._active_capture()
        if cap and (not cap.parts or cap.parts[-1] != " "):
            cap.parts.append(" ")

    def _new_path(self, tag: str, attrs: dict[str, str]) -> tuple[str, ...]:
        parent = self._parent()
        counts = parent.child_counts if parent else self.root_counts
        counts[tag] += 1
        element_id = attrs.get("id", "").strip()
        if element_id and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.:-]*", element_id):
            component = f"{tag}#{element_id}"
        else:
            component = f"{tag}:nth-of-type({counts[tag]})"
        return (*(parent.path_parts if parent else ()), component)

    @staticmethod
    def _display_path(parts: tuple[str, ...]) -> str:
        start = 0
        for i, component in enumerate(parts):
            if "#" in component:
                start = i
        return " > ".join(parts[start:]) or "document"

    @staticmethod
    def _hidden(tag: str, attrs: dict[str, str]) -> bool:
        if "hidden" in attrs or attrs.get("aria-hidden", "").lower() == "true":
            return True
        if tag == "input" and attrs.get("type", "").lower() == "hidden":
            return True
        style = re.sub(r"\s+", "", attrs.get("style", "").lower())
        return "display:none" in style or "visibility:hidden" in style

    def _candidate(self, tag: str, in_svg: bool) -> bool:
        return (in_svg and tag in {"title", "desc", "text"}) or tag in (
            HTML_PROSE_TAGS | HTML_LABEL_TAGS | HTML_HEADING_TAGS | {"td", "title"}
        )

    def _start_capture(self, frame: _Frame, source: str, form: str, type_override: str | None, heading: bool = False) -> None:
        frame.capture = _Capture(
            tag=frame.tag, line=self.getpos()[0], source=source, section_hint=self.section_hint,
            path=self._display_path(frame.path_parts), language=_norm_lang(frame.lang), form=form,
            type_override=type_override, heading=heading,
        )

    def _finish_capture(self, cap: _Capture) -> None:
        text = re.sub(r"\s+", " ", "".join(cap.parts)).strip()
        if not text:
            return
        if cap.heading:
            if HEADING_PROCEDURAL.search(text):
                self.section_hint = "procedural"
            elif HEADING_DESCRIPTIVE.search(text):
                self.section_hint = "descriptive"
            else:
                self.section_hint = None
            self.stats["headings_used"] += 1
            if not self.include_headings:
                return
        form = cap.form
        if form == "auto-table":
            form = "prose" if _looks_sentence_like(text) else "label"
        if form == "literal":
            self.stats["literal_blocks_excluded"] += 1
            return
        kind = cap.type_override or _classify(text, self.requested, cap.source, cap.section_hint)
        self.blocks.append(Block(text, cap.line, kind, cap.source, form, cap.path, cap.language))

    def _close_top(self) -> None:
        if not self.frames:
            return
        frame = self.frames.pop()
        if frame.literal_opened:
            cap = self._active_capture()
            if cap:
                cap.parts.append("`")
        if frame.capture:
            self._finish_capture(frame.capture)

    def _attr_blocks(self, attrs: dict[str, str], frame: _Frame, type_override: str | None, form_override: str | None) -> None:
        if not self.include_accessibility or not _lang_is_english(frame.lang):
            return
        for attr, default_form in A11Y_ATTRS.items():
            value = re.sub(r"\s+", " ", attrs.get(attr, "")).strip()
            if not value:
                continue
            form = form_override or default_form
            if form == "literal":
                continue
            source = f"html-{attr}"
            kind = type_override or _classify(value, self.requested, source, self.section_hint)
            self.blocks.append(Block(value, self.getpos()[0], kind, source, form, self._display_path(frame.path_parts), _norm_lang(frame.lang)))

    def _open(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attrs = {k.lower(): (v or "") for k, v in attrs_list}
        parent = self._parent()
        parent_ignored = bool(parent and parent.ignored)
        lang = attrs.get("data-ste-language") or attrs.get("lang") or attrs.get("xml:lang") or (parent.lang if parent else None)
        in_svg = bool((parent and parent.in_svg) or tag == "svg")
        path_parts = self._new_path(tag, attrs)
        reason = None
        if not parent_ignored:
            if "data-ste-ignore" in attrs:
                reason = "explicit_ste_ignore"
            elif self._hidden(tag, attrs):
                reason = "hidden"
            elif tag in HTML_SKIP_TAGS:
                reason = tag
            elif in_svg and tag in SVG_SKIP_SUBTREES:
                reason = f"svg_{tag}"
        frame = _Frame(tag, path_parts, parent_ignored or reason is not None, lang, in_svg)
        self.frames.append(frame)
        if reason:
            self.stats[f"{reason}_subtrees_excluded"] += 1
        if frame.ignored:
            self._boundary()
            return
        if in_svg and tag in SVG_IMPLEMENTATION_TAGS:
            self.stats["svg_implementation_elements_excluded"] += 1

        type_override = attrs.get("data-ste-type", "").strip().lower() or None
        if type_override and type_override not in VALID_TYPES:
            self.warnings.append(f"line {self.getpos()[0]}: invalid data-ste-type={type_override!r} ignored")
            type_override = None
        form_override = attrs.get("data-ste-form", "").strip().lower() or None
        if form_override and form_override not in VALID_FORMS:
            self.warnings.append(f"line {self.getpos()[0]}: invalid data-ste-form={form_override!r} ignored")
            form_override = None
        self._attr_blocks(attrs, frame, type_override, form_override)
        if tag == "input" and attrs.get("type", "").lower() in {"button", "submit", "reset"}:
            value = re.sub(r"\s+", " ", attrs.get("value", "")).strip()
            if value and _lang_is_english(frame.lang):
                form = form_override or "label"
                if form != "literal":
                    source = "html-input-value"
                    kind = type_override or _classify(value, self.requested, source, self.section_hint)
                    self.blocks.append(Block(value, self.getpos()[0], kind, source, form,
                                             self._display_path(frame.path_parts), _norm_lang(frame.lang)))

        if not _lang_is_english(lang):
            key = "non_english_blocks_excluded" if self._candidate(tag, in_svg) else "non_english_inline_regions_excluded"
            self.stats[key] += 1
            self._boundary()
            return
        if tag in HTML_LITERAL_TAGS:
            cap = self._active_capture(omit_top=True)
            if cap:
                self._append_text(cap, "`")
                frame.literal_opened = True
            return
        if tag in {"br", "wbr"} or (in_svg and tag == "tspan"):
            self._boundary()
            return
        ancestor_capture = self._active_capture(omit_top=True)
        if in_svg and tag == "title":
            self._start_capture(frame, "svg-title", form_override or "accessibility-label", type_override)
        elif in_svg and tag == "desc":
            self._start_capture(frame, "svg-desc", form_override or "accessibility-description", type_override)
        elif in_svg and tag == "text":
            if self.include_svg_labels:
                self._start_capture(frame, "svg-text", form_override or "label", type_override)
            else:
                self.stats["svg_label_blocks_excluded"] += 1
        elif tag in HTML_HEADING_TAGS:
            self._start_capture(frame, f"html-{tag}", form_override or "label", type_override, heading=True)
        elif tag == "title" and not in_svg:
            self._start_capture(frame, "html-title", form_override or "label", type_override)
        elif tag in HTML_PROSE_TAGS:
            if tag == "li":
                list_tag = next((f.tag for f in reversed(self.frames) if f.tag in {"ol", "ul"}), None)
                source = "numbered-list" if list_tag == "ol" else "bullet-list"
            else:
                source = f"html-{tag}"
            self._start_capture(frame, source, form_override or "prose", type_override)
        elif tag in HTML_LABEL_TAGS:
            # Inline labels inside a prose block belong to that prose block. Standalone
            # labels get their own lightweight review block.
            if ancestor_capture is None:
                self._start_capture(frame, f"html-{tag}", form_override or "label", type_override)
        elif tag == "td":
            self._start_capture(frame, "html-td", form_override or "auto-table", type_override)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        self._open(tag, attrs)
        if tag in HTML_VOID_TAGS:
            self._close_top()

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._open(tag.lower(), attrs)
        self._close_top()

    @staticmethod
    def _append_text(cap: _Capture, data: str) -> None:
        if not data:
            return
        previous = "".join(cap.parts)
        prev = previous[-1:] if previous else ""
        first = data[:1]
        # HTML authors often rely on inline-element margins rather than source
        # whitespace. Keep words from adjacent elements separate, but do not insert
        # spaces before punctuation or across an explicit hyphen/slash.
        if prev and first and not prev.isspace() and not first.isspace():
            if (prev.isalnum() or prev in "`)]}") and (first.isalnum() or first in '`([{"'):
                cap.parts.append(" ")
        cap.parts.append(data)

    def handle_data(self, data: str) -> None:
        if not self.frames or self.frames[-1].ignored or not _lang_is_english(self.frames[-1].lang):
            return
        cap = self._active_capture()
        if cap:
            if self.frames[-1].tag in HTML_LITERAL_TAGS and self.frames[-1].literal_opened:
                cap.parts.append(data)
            else:
                self._append_text(cap, data)

    def handle_comment(self, data: str) -> None:
        del data
        self.stats["html_comments_excluded"] += 1

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        index = len(self.frames) - 1
        while index >= 0 and self.frames[index].tag != tag:
            index -= 1
        if index < 0:
            return
        while len(self.frames) > index:
            self._close_top()

    def close(self) -> None:
        super().close()
        while self.frames:
            self._close_top()


def _dedupe(blocks: Iterable[Block]) -> tuple[list[Block], int]:
    priority = {"prose": 4, "accessibility-description": 3, "label": 2, "accessibility-label": 1}
    out: list[Block] = []
    seen: dict[tuple[str, str], int] = {}
    removed = 0
    for block in blocks:
        key = (block.location, re.sub(r"\s+", " ", block.text).strip().casefold())
        if key not in seen:
            seen[key] = len(out)
            out.append(block)
        else:
            removed += 1
            i = seen[key]
            if priority.get(block.content_form, 0) > priority.get(out[i].content_form, 0):
                out[i] = block
    return out, removed


def extract_html_blocks(text: str, requested: str, *, include_accessibility: bool = True,
                        include_svg_labels: bool = True, include_headings: bool = False) -> tuple[list[Block], dict]:
    parser = _HTMLExtractor(requested, include_accessibility, include_svg_labels, include_headings)
    parser.feed(text)
    parser.close()
    blocks, duplicates = _dedupe(parser.blocks)
    by_form = Counter(b.content_form for b in blocks)
    by_source = Counter(b.source for b in blocks)
    excluded = {k: v for k, v in parser.stats.items() if k.endswith("_excluded") and v}
    if duplicates:
        excluded["duplicate_blocks_collapsed"] = duplicates
    return blocks, {
        "included": {"blocks": len(blocks), "by_content_form": dict(sorted(by_form.items())),
                     "by_source": dict(sorted(by_source.items()))},
        "classification": {"headings_used": parser.stats.get("headings_used", 0)},
        "excluded": dict(sorted(excluded.items())),
        "warnings": parser.warnings,
        "not_checked": [
            "CSS rules and generated CSS content", "JavaScript-generated or runtime-inserted text",
            "Markup element names and ordinary attributes",
            "SVG geometry, coordinates, presentation attributes, and definitions",
            "Text in excluded non-English, hidden, code, or data-ste-ignore regions",
        ],
    }


def _strip_label(text: str) -> str:
    return re.sub(r"^\s*(?:\*\*)?(?:NOTE|WARNING|CAUTION|DANGER|NOTICE)(?:\*\*)?\s*:\s*", "", text, flags=re.I)


def _first_word(text: str) -> str:
    match = re.match(r"([A-Za-z]+(?:-[A-Za-z]+)?)", re.sub(r"^[\s>*_`\[\]()]+", "", _strip_label(text)))
    return match.group(1).lower() if match else ""


def _looks_imperative(text: str) -> bool:
    first = _first_word(text)
    if first in IMPERATIVE_VERBS:
        return True
    lower = _strip_label(text).lstrip().lower()
    if lower.startswith(("do not ", "make sure ", "be sure ")):
        return True
    if re.match(r"^you\s+(?:must|shall|should|need to)\s+[a-z-]+", lower):
        return True
    if lower.startswith(("if ", "when ", "unless ", "after ", "before ")) and "," in text:
        tail = text.split(",", 1)[1].lstrip()
        return _first_word(tail) in IMPERATIVE_VERBS or tail.lower().startswith(("do not ", "make sure "))
    return False


def _classify(text: str, requested: str, source: str, section_hint: str | None) -> str:
    if NOTE_RE.match(text): return "note"
    if SAFETY_RE.match(text): return "safety"
    if requested != "mixed": return requested
    if section_hint: return section_hint
    if source == "numbered-list" or _looks_imperative(text): return "procedural"
    return "descriptive"


def _make_block(text: str, line: int, requested: str, source: str, hint: str | None,
                form: str = "prose", location: str | None = None) -> Block:
    return Block(text, line, _classify(text, requested, source, hint), source, form, location or f"line {line}", "en")


def extract_blocks(text: str, requested: str, *, include_headings: bool = False) -> list[Block]:
    blocks: list[Block] = []
    current: list[str] = []
    current_line = 1
    in_fence = False
    fence = ""
    hint: str | None = None

    def flush() -> None:
        nonlocal current
        value = " ".join(x.strip() for x in current if x.strip()).strip()
        if value:
            blocks.append(_make_block(value, current_line, requested, "paragraph", hint))
        current = []

    for line_no, line in enumerate(text.splitlines(), 1):
        m = FENCE_RE.match(line)
        if m:
            token = m.group(1)
            if not in_fence:
                flush(); in_fence = True; fence = token
            elif token == fence:
                in_fence = False; fence = ""
            continue
        if in_fence: continue
        m = HEADING_RE.match(line)
        if m:
            flush(); title = m.group(1)
            hint = "procedural" if HEADING_PROCEDURAL.search(title) else "descriptive" if HEADING_DESCRIPTIVE.search(title) else None
            if include_headings:
                blocks.append(_make_block(title, line_no, requested, "markdown-heading", hint, "label"))
            continue
        if not line.strip(): flush(); continue
        if TABLE_DIVIDER_RE.match(line): flush(); continue
        m = LIST_RE.match(line)
        if m:
            flush(); body = m.group("body").strip()
            if body:
                source = "numbered-list" if m.group("marker")[0].isdigit() else "bullet-list"
                blocks.append(_make_block(body, line_no, requested, source, hint))
            continue
        if line.lstrip().startswith("|") and line.rstrip().endswith("|"):
            flush()
            for i, cell in enumerate((c.strip() for c in line.strip().strip("|").split("|")), 1):
                if cell:
                    form = "prose" if _looks_sentence_like(cell) else "label"
                    blocks.append(_make_block(cell, line_no, requested, "markdown-table-cell", hint, form, f"line {line_no}, table cell {i}"))
            continue
        if not current: current_line = line_no
        current.append(line)
    flush()
    return blocks


def extract_text_blocks(text: str, requested: str) -> list[Block]:
    blocks: list[Block] = []
    current: list[str] = []
    start = 1
    def flush() -> None:
        nonlocal current
        value = " ".join(x.strip() for x in current if x.strip()).strip()
        if value: blocks.append(_make_block(value, start, requested, "text-paragraph", None))
        current = []
    for line_no, line in enumerate(text.splitlines(), 1):
        if not line.strip(): flush(); continue
        if not current: start = line_no
        current.append(line)
    flush(); return blocks


def _generic_details(blocks: list[Block], input_format: str, text: str, include_headings: bool) -> dict:
    by_form = Counter(b.content_form for b in blocks)
    by_source = Counter(b.source for b in blocks)
    excluded = {}
    not_checked = []
    if input_format == "markdown":
        boundaries = sum(bool(FENCE_RE.match(line)) for line in text.splitlines())
        if boundaries: excluded["fenced_code_boundaries_seen"] = boundaries
        not_checked.append("Content inside fenced code blocks")
        if not include_headings: not_checked.append("Markdown headings (used only for classification)")
    return {"included": {"blocks": len(blocks), "by_content_form": dict(sorted(by_form.items())),
                         "by_source": dict(sorted(by_source.items()))},
            "classification": {}, "excluded": excluded, "warnings": [], "not_checked": not_checked}


def extract_document(text: str, requested_type: str = "mixed", *, input_format: str = "markdown",
                     include_accessibility: bool = True, include_svg_labels: bool = True,
                     include_headings: bool = False) -> ExtractionResult:
    if input_format in {"html", "svg"}:
        blocks, details = extract_html_blocks(text, requested_type, include_accessibility=include_accessibility,
                                             include_svg_labels=include_svg_labels, include_headings=include_headings)
    elif input_format == "markdown":
        blocks = extract_blocks(text, requested_type, include_headings=include_headings)
        details = _generic_details(blocks, input_format, text, include_headings)
    elif input_format == "text":
        blocks = extract_text_blocks(text, requested_type)
        details = _generic_details(blocks, input_format, text, include_headings)
    else:
        raise ValueError(f"unsupported input format: {input_format}")
    return ExtractionResult(input_format, blocks, details)


def _looks_sentence_like(text: str) -> bool:
    clean = re.sub(r"`[^`]*`", "LITERAL", text).strip()
    return bool(re.search(r"[.!?][\"'”’)]?$", clean)) or count_words(clean) > 12


def _protect_for_sentences(text: str) -> str:
    chars = list(text)
    def protect(a: int, b: int) -> None:
        for i in range(a, b):
            if chars[i] in ".!?": chars[i] = "\ue000"
    for pattern in (re.compile(r"`[^`\n]*`"), re.compile(r"https?://\S+"),
                    re.compile(r"\[[^\]]+\]\([^)]+\)"), re.compile(r"\([^()]*\)"),
                    re.compile(r'"[^"\n]*"|“[^”\n]*”')):
        for m in pattern.finditer(text): protect(m.start(), m.end())
    for m in re.finditer(r"(?<=\d)\.(?=\d)", text): chars[m.start()] = "\ue000"
    for abbr in ("e.g.", "i.e.", "etc.", "Mr.", "Mrs.", "Dr.", "vs."):
        for m in re.finditer(re.escape(abbr), text, re.I): protect(m.start(), m.end())
    return "".join(chars)


def split_sentences(text: str) -> list[str]:
    protected = _protect_for_sentences(text)
    out: list[str] = []; start = 0
    for m in re.finditer(r"(?<=[.!?])\s+", protected):
        value = text[start:m.start()].strip()
        if value: out.append(value)
        start = m.end()
    value = text[start:].strip()
    if value: out.append(value)
    return out


def count_words(sentence: str) -> int:
    text = re.sub(r"`[^`\n]*`", " IDENTIFIER ", sentence)
    text = re.sub(r"https?://\S+", " URL ", text)
    text = re.sub(r"\[[^\]]+\]\([^)]+\)", " LINK ", text)
    old = None
    while old != text:
        old = text; text = re.sub(r"\([^()]*\)", " PAREN ", text)
    text = re.sub(r'"[^"\n]*"|“[^”\n]*”', " QUOTEDTEXT ", text)
    text = re.sub(r"\b\d+(?:[.,]\d+)?\s*(?:%|°[CF]|[kmcd]?m|kg|g|ms|s|min|h|Hz|kHz|MHz|GHz|V|A|W|kW|MB|GB|TB)\b", " MEASUREMENT ", text, flags=re.I)
    return len(re.findall(r"[A-Za-z0-9]+(?:[-_/'][A-Za-z0-9]+)*", re.sub(r"[*_>#]", " ", text)))


def _mask_literals(text: str) -> str:
    text = re.sub(r"`[^`\n]*`", " LITERAL ", text)
    text = re.sub(r"https?://\S+", " URL ", text)
    return re.sub(r"\[[^\]]+\]\([^)]+\)", " LINK ", text)


def _severity(strict: bool) -> str: return "error" if strict else "warning"
def _excerpt(text: str, limit: int = 180) -> str:
    value = re.sub(r"\s+", " ", text).strip()
    return value if len(value) <= limit else value[:limit - 1] + "…"


def _finding(block: Block, code: str, severity: str, category: str, message: str, text: str) -> Finding:
    return Finding(code, severity, category, block.start_line, block.kind, block.content_form,
                   block.source, block.location or f"line {block.start_line}", message, _excerpt(text))


def _lint_label(block: Block, strict: bool) -> list[Finding]:
    out: list[Finding] = []; masked = _mask_literals(block.text); words = count_words(block.text)
    if words > LABEL_WORD_LIMIT:
        out.append(_finding(block, "LABEL_LENGTH_CANDIDATE", "review", "layout-candidate",
                            f"This label has approximately {words} words. Check whether readers can scan it as a label.", block.text))
    if CONTRACTION_RE.search(masked):
        out.append(_finding(block, "CONTRACTION", _severity(strict), "mechanical",
                            "A contraction needs review; strict STE uses the complete form.", block.text))
    if LATIN_RE.search(masked):
        out.append(_finding(block, "LATIN_ABBREVIATION_CANDIDATE", "info", "general-recommendation",
                            "A Latin abbreviation can reduce clarity. Consider an explicit English phrase.", block.text))
    filler = FILLER_RE.search(masked)
    if filler:
        out.append(_finding(block, "PROMOTIONAL_WORD_CANDIDATE", "info", "style-candidate",
                            f"Check whether '{filler.group(1)}' states a measurable fact or only adds emphasis.", block.text))
    modal = MODAL_RE.search(masked)
    if modal:
        out.append(_finding(block, "MODAL_MEANING_REVIEW", "review", "meaning-candidate",
                            f"The modal '{modal.group(1)}' needs semantic review. Do not replace it until its force is clear.", block.text))
    return out


def _lint_prose(block: Block, strict: bool, requested: str) -> tuple[list[Finding], int, int]:
    out: list[Finding] = []; sentences = split_sentences(block.text); longest = 0
    if block.kind in {"descriptive", "note"} and len(sentences) > 6:
        out.append(_finding(block, "PARAGRAPH_SENTENCE_COUNT", _severity(strict), "mechanical",
                            f"This block has {len(sentences)} sentences; strict descriptive text permits no more than six.", block.text))
    for sentence in sentences:
        masked = _mask_literals(sentence); words = count_words(sentence); longest = max(longest, words)
        limit = STRICT_LIMITS[block.kind]
        if words > limit:
            out.append(_finding(block, "SENTENCE_LENGTH", _severity(strict), "mechanical",
                                f"This {block.kind} sentence has approximately {words} words; the strict limit is {limit}.", sentence))
        if CONTRACTION_RE.search(masked):
            out.append(_finding(block, "CONTRACTION", _severity(strict), "mechanical",
                                "A contraction needs review; strict STE uses the complete form.", sentence))
        if ";" in masked:
            out.append(_finding(block, "SEMICOLON", _severity(strict), "mechanical",
                                "A semicolon is not permitted in strict STE. Use separate sentences.", sentence))
        for regex, code, message in (
            (PERFECT_RE, "PERFECT_TENSE_CANDIDATE", "This sentence can contain a perfect construction. Check whether a simple tense preserves the meaning."),
            (PROGRESSIVE_RE, "PROGRESSIVE_FORM_CANDIDATE", "This sentence can contain a progressive construction. Check the verb form in context."),
            (ING_CLAUSE_RE, "ING_CLAUSE_CANDIDATE", "An -ing clause after a comma can be ambiguous. Check whether it needs a complete sentence."),
        ):
            if regex.search(masked): out.append(_finding(block, code, "review", "linguistic-candidate", message, sentence))
        if PASSIVE_RE.search(masked):
            msg = "This sentence can contain passive voice. Procedures normally need active voice and a clear actor." if block.kind in {"procedural", "safety"} else "This sentence can contain passive voice. In a description, confirm that the actor is unknown or irrelevant."
            out.append(_finding(block, "PASSIVE_VOICE_CANDIDATE", "review", "linguistic-candidate", msg, sentence))
        modal = MODAL_RE.search(masked)
        if modal: out.append(_finding(block, "MODAL_MEANING_REVIEW", "review", "meaning-candidate", f"The modal '{modal.group(1)}' needs semantic review. Do not replace it until its force is clear.", sentence))
        if LATIN_RE.search(masked): out.append(_finding(block, "LATIN_ABBREVIATION_CANDIDATE", "info", "general-recommendation", "A Latin abbreviation can reduce clarity. Consider an explicit English phrase.", sentence))
        filler = FILLER_RE.search(masked)
        if filler: out.append(_finding(block, "PROMOTIONAL_WORD_CANDIDATE", "info", "style-candidate", f"Check whether '{filler.group(1)}' states a measurable fact or only adds emphasis.", sentence))
        if block.kind in {"procedural", "safety"}:
            condition = CONDITION_RE.search(masked)
            if condition and condition.start() > max(8, len(masked) // 5):
                out.append(_finding(block, "CONDITION_ORDER_REVIEW", "review", "logic-candidate", "This condition appears after other text. Move it first only if the reader must know it before the command.", sentence))
            tail = re.search(r"\b(?:and|then)\s+(" + "|".join(sorted(IMPERATIVE_VERBS, key=len, reverse=True)) + r")\b", masked, re.I)
            if tail and _looks_imperative(masked):
                out.append(_finding(block, "MULTIPLE_INSTRUCTION_CANDIDATE", "review", "logic-candidate", "This sentence can contain more than one instruction. Keep them together only if the actions occur at the same time.", sentence))
        if block.kind == "note" and _looks_imperative(masked):
            out.append(_finding(block, "NOTE_INSTRUCTION_CANDIDATE", "review", "logic-candidate", "A note appears to contain an instruction. Move the instruction into a procedural step.", sentence))
        if requested == "descriptive" and _looks_imperative(masked):
            out.append(_finding(block, "IMPERATIVE_IN_DESCRIPTION_CANDIDATE", "review", "classification-candidate", "This descriptive sentence appears to start with an imperative verb. Check the block classification.", sentence))
    return out, len(sentences), longest


def lint_extraction(extraction: ExtractionResult, requested: str, strict: bool) -> dict:
    findings: list[Finding] = []; sentence_total = 0; label_total = 0; longest = 0
    for block in extraction.blocks:
        if block.content_form in FULL_PROSE_FORMS:
            fs, count, length = _lint_prose(block, strict, requested)
            findings.extend(fs); sentence_total += count; longest = max(longest, length)
        elif block.content_form in LABEL_FORMS:
            findings.extend(_lint_label(block, strict)); label_total += 1
    words = {w.lower() for w in re.findall(r"\b[A-Za-z]+\b", _mask_literals("\n".join(b.text for b in extraction.blocks)))}
    for concept, variants in TERM_GROUPS.items():
        used = sorted(words & variants)
        if len(used) > 1:
            findings.append(Finding("TERM_VARIATION_CANDIDATE", "review", "terminology-candidate", 1, "document", "document", "document", "document", f"Possible terminology variation for '{concept}': {', '.join(used)}. Confirm whether these words name the same concept.", ", ".join(used)))
    counts = {x: 0 for x in ("error", "warning", "review", "info")}
    for f in findings: counts[f.severity] += 1
    by_form = Counter(b.content_form for b in extraction.blocks)
    return {
        "tool": "ste_lint", "version": VERSION, "requested_type": requested,
        "input_format": extraction.input_format, "strict": strict, "extraction": extraction.details,
        "summary": {"blocks_checked": len(extraction.blocks), "by_content_form": dict(sorted(by_form.items())),
                    "sentences_checked": sentence_total, "labels_checked": label_total,
                    "longest_sentence_words_approx": longest, "findings": len(findings), "by_severity": counts},
        "scope": {"mechanical_and_heuristic_review": True, "format_aware_extraction": True,
                  "official_dictionary_checked": False, "project_glossary_checked": False,
                  "technical_accuracy_checked": False, "semantic_fidelity_checked": False,
                  "compliance_verdict": False},
        "limitations": ["Sentence and word counts are approximations for extracted prose.",
                        "Linguistic candidates can be false positives and require context.",
                        "HTML review covers static extracted text, not text generated at runtime.",
                        "A zero-result run does not prove ASD-STE100 compliance."],
        "findings": [asdict(f) for f in findings],
    }


def lint_text(text: str, requested_type: str = "mixed", strict: bool = False,
              input_format: str = "markdown", include_accessibility: bool = True,
              include_svg_labels: bool = True, include_headings: bool = False, **legacy: object) -> dict:
    if "include_svg_text" in legacy: include_svg_labels = bool(legacy.pop("include_svg_text"))
    if legacy: raise TypeError(f"unexpected option(s): {', '.join(sorted(legacy))}")
    return lint_extraction(extract_document(text, requested_type, input_format=input_format,
                                            include_accessibility=include_accessibility,
                                            include_svg_labels=include_svg_labels,
                                            include_headings=include_headings), requested_type, strict)


def _counts(values: dict[str, int]) -> str:
    return ", ".join(f"{k}={v}" for k, v in values.items()) or "none"


def _scope_lines(lines: list[str], details: dict) -> None:
    inc = details.get("included", {})
    lines.append("Included blocks: " + _counts(inc.get("by_content_form", {})) + f" (total={inc.get('blocks', 0)})")
    classification = {k: v for k, v in details.get("classification", {}).items() if v}
    if classification: lines.append("Classification context: " + _counts(classification))
    if details.get("excluded"): lines.append("Excluded or collapsed: " + _counts(details["excluded"]))
    for warning in details.get("warnings", []): lines.append("Extraction warning: " + warning)
    if details.get("not_checked"): lines.append("Not checked by the source adapter: " + "; ".join(details["not_checked"]))


def render_text(report: dict, source: str) -> str:
    summary = report["summary"]
    lines = [f"STE mechanical review: {source}", f"Input format: {report['input_format']}",
             "Status: heuristic aid only; no compliance verdict"]
    _scope_lines(lines, report["extraction"])
    lines += [f"Checked {summary['blocks_checked']} blocks, {summary['sentences_checked']} prose sentences, and {summary['labels_checked']} labels. Found {summary['findings']} items.",
              "Severity counts: " + _counts(summary["by_severity"])]
    if not report["findings"]:
        lines.append("No mechanical findings. Vocabulary, meaning, and technical accuracy were not verified.")
        return "\n".join(lines)
    lines.append("")
    for f in report["findings"]:
        lines.append(f"[{f['severity'].upper()}] line {f['line']} · {f['location']} · {f['code']} ({f['content_form']}/{f['block_type']}): {f['message']}")
        lines.append("  " + f["excerpt"])
    lines += ["", "Limitations:", *["- " + x for x in report["limitations"]]]
    return "\n".join(lines)


def extraction_payload(extraction: ExtractionResult) -> dict:
    return {"tool": "ste_extract", "version": VERSION, "input_format": extraction.input_format,
            "extraction": extraction.details, "blocks": [asdict(b) for b in extraction.blocks]}


def render_extraction_text(extraction: ExtractionResult, source: str) -> str:
    lines = [f"STE extraction preview: {source}", f"Input format: {extraction.input_format}"]
    _scope_lines(lines, extraction.details); lines.append("")
    for i, b in enumerate(extraction.blocks, 1):
        lines += [f"[{i}] line {b.start_line} · {b.location} · {b.content_form}/{b.kind} · {b.source}", "  " + _excerpt(b.text, 400)]
    return "\n".join(lines)


def _read(path: str) -> tuple[str, str]:
    if path == "-": return sys.stdin.read(), "stdin"
    p = Path(path)
    try: return p.read_text(encoding="utf-8"), str(p)
    except (OSError, UnicodeDecodeError) as exc: raise SystemExit(f"error: cannot read {p}: {exc}") from exc


def _detect_input_format(path: str, text: str, requested: str) -> str:
    if requested != "auto": return requested
    if path != "-":
        suffix = Path(path).suffix.lower()
        if suffix in {".html", ".htm", ".xhtml"}: return "html"
        if suffix == ".svg": return "svg"
        if suffix in {".md", ".markdown", ".mdown", ".mkd"}: return "markdown"
        if suffix in {".txt", ".text"}: return "text"
    prefix = text.lstrip()[:1024].lower()
    if prefix.startswith("<!doctype html") or re.search(r"<html(?:\s|>)", prefix): return "html"
    if re.search(r"<svg(?:\s|>)", prefix): return "svg"
    if re.search(r"(?m)^\s{0,3}#{1,6}\s+", text) or re.search(r"(?m)^\s*```", text): return "markdown"
    return "text"


def _write_json(path: str, payload: dict) -> None:
    content = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    if path == "-": sys.stdout.write(content)
    else: Path(path).write_text(content, encoding="utf-8")


def _exit_for(report: dict, fail_on: str) -> int:
    if fail_on == "none": return 0
    c = report["summary"]["by_severity"]
    return int(bool(c["error"] if fail_on == "error" else c["error"] or c["warning"]))


def self_test() -> None:
    report = lint_text("Install the package and record the complete deployment identifier in the operations log before you restart the production service safely later today.", "procedural", True)
    assert report["summary"]["by_severity"]["error"]
    report = lint_text("Restart the service if the health check remains red.", "procedural", True)
    assert "CONDITION_ORDER_REVIEW" in {f["code"] for f in report["findings"]}
    report = lint_text("```bash\nthis isn't prose; should remain exact\n```\nRun `deploy; --force`.", "procedural", True)
    assert not ({"CONTRACTION", "SEMICOLON"} & {f["code"] for f in report["findings"]})
    html = "<!doctype html><html lang='en'><style>.x{color:red;}</style><p>Restart the service.</p><svg><style>.s{fill:red;}</style><desc>This accessibility description has been written in passive voice.</desc><text>derive; seeded splits;</text><path d='M0 0'/></svg><p lang='de'>Nicht Englisch.</p></html>"
    report = lint_text(html, input_format="html", strict=True)
    excerpts = "\n".join(f["excerpt"] for f in report["findings"])
    assert "color:red" not in excerpts and "M0 0" not in excerpts
    assert any(f["source"] == "svg-desc" for f in report["findings"])
    assert not any(f["source"] == "svg-text" and f["code"] == "SEMICOLON" for f in report["findings"])
    print("ste_lint self-test: OK")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("path", nargs="?", default="-", help="UTF-8 text, Markdown, HTML, or SVG file; use - for stdin")
    p.add_argument("--type", choices=("mixed", "procedural", "descriptive"), default="mixed")
    p.add_argument("--strict", action="store_true")
    p.add_argument("--input-format", choices=("auto", "text", "markdown", "html", "svg"), default="auto")
    p.add_argument("--skip-accessibility-text", action="store_true")
    p.add_argument("--skip-svg-labels", "--skip-svg-text", dest="skip_svg_labels", action="store_true")
    p.add_argument("--include-headings", action="store_true")
    p.add_argument("--extract-only", action="store_true")
    p.add_argument("--dump-extracted", metavar="PATH")
    p.add_argument("--format", choices=("text", "json"), default="text")
    p.add_argument("--fail-on", choices=("error", "warning", "none"), default="error")
    p.add_argument("--self-test", action="store_true")
    p.add_argument("--version", action="version", version=f"%(prog)s {VERSION}")
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.self_test: self_test(); return 0
    text, source = _read(args.path)
    fmt = _detect_input_format(args.path, text, args.input_format)
    extraction = extract_document(text, args.type, input_format=fmt,
                                  include_accessibility=not args.skip_accessibility_text,
                                  include_svg_labels=not args.skip_svg_labels,
                                  include_headings=args.include_headings)
    if args.dump_extracted:
        _write_json(args.dump_extracted, extraction_payload(extraction))
        if args.dump_extracted == "-" and not args.extract_only: return 0
    if args.extract_only:
        print(json.dumps(extraction_payload(extraction), indent=2, ensure_ascii=False) if args.format == "json" else render_extraction_text(extraction, source))
        return 0
    report = lint_extraction(extraction, args.type, args.strict)
    print(json.dumps(report, indent=2, ensure_ascii=False) if args.format == "json" else render_text(report, source))
    return _exit_for(report, args.fail_on)


if __name__ == "__main__":
    raise SystemExit(main())
