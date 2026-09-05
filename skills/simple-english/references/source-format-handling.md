# Source-format handling

Read this guide when the source contains HTML, SVG, embedded styling, generated documentation, code examples, interface strings, or mixed languages.

## Core rule

Do not apply language heuristics to raw structured source. First extract language-bearing content into typed blocks. Keep source locations and the distinction between prose, accessibility descriptions, labels, and literals.

Regular-expression tag stripping is not sufficient. It can join unrelated elements, turn CSS declarations into sentences, expose SVG paths as words, erase language boundaries, and lose safe edit locations.

## HTML and standalone SVG adapter defaults

### Full prose profile

The checker includes `<p>`, `<li>`, `<dd>`, `<figcaption>`, `<blockquote>`, `<textarea>`, and sentence-like `<td>` cells as prose.

### Label profile

The checker includes document `<title>`, standalone `<a>`, `<span>`, and `<small>` text, `<dt>`, `<caption>`, `<th>`, `<summary>`, `<label>`, `<button>`, `<legend>`, `<option>`, `<output>`, button-like `<input value>`, fragment-like `<td>` cells, and optional headings as labels. Inline label elements inside a prose block stay inside that prose block instead of producing duplicate blocks.

Labels do not receive paragraph, passive-voice, tense, ordinary semicolon, condition-order, or multiple-instruction checks.

### Accessibility content

The checker includes `aria-label`, `alt`, `placeholder`, tooltip `title`, `aria-description`, SVG `<title>`, and SVG `<desc>`.

`aria-description` and SVG `<desc>` use the full accessibility-description profile. Other short accessibility strings use the label profile.

When visible text and an accessibility attribute are identical on the same element, the checker keeps one block and prefers the visible text. Different wording remains separate.

### Fixed literals

Inline `<code>`, `<kbd>`, `<samp>`, and `<var>` remain in their containing block but count as one fixed token. Punctuation and contractions inside them do not create findings.

### Excluded regions

The adapter excludes:

- `<style>`, `<script>`, `<template>`, `<noscript>`, `<pre>`, and `<math>`
- comments
- `hidden`, `aria-hidden="true"`, inline `display:none` or `visibility:hidden`, hidden inputs, and `data-ste-ignore`
- non-English blocks during an English run
- element names and ordinary attributes
- CSS declarations and generated `content`
- JavaScript-generated or runtime-inserted text

External CSS can hide content that a static parser cannot detect. Treat the extraction preview as part of the audit evidence.

## SVG policy

Do not ignore the complete SVG subtree. SVG can contain real language.

Exclude SVG-local CSS, `<defs>`, `<metadata>`, `<symbol>`, `<marker>`, `<pattern>`, paths, shapes, gradients, filters, coordinates, classes, and presentation attributes.

Keep:

- `<desc>` as accessibility prose
- `<title>` as an accessibility label
- each `<text>` element as a separate label

Combine nested `<tspan>` text only inside its owning `<text>` element. Use `--skip-svg-labels` to omit visible labels while retaining `<title>` and `<desc>`.

## Language and location

The adapter inherits `lang` and SVG `xml:lang`. An English run includes `en` and regional forms such as `en-GB`, and excludes other languages. A non-English inline span is omitted without joining surrounding words.

Each HTML or SVG block carries a start line, DOM-like path, source origin, semantic type, and content form. Paths start at the nearest useful id when possible and otherwise use `:nth-of-type(...)`.

## Controlled overrides

```html
<div data-ste-ignore>Generated diagnostics</div>
<p data-ste-type="procedural">Restart the worker.</p>
<text data-ste-form="label">Policy pass</text>
<section data-ste-language="en">English content</section>
```

Supported attributes:

- `data-ste-ignore`
- `data-ste-type="procedural|descriptive|note|safety"`
- `data-ste-form="prose|accessibility-description|label|accessibility-label|literal"`
- `data-ste-language="..."`

Invalid override values are ignored and reported as extraction warnings.

## CLI

```bash
python3 scripts/ste_lint.py --input-format auto document.html
python3 scripts/ste_lint.py --input-format svg diagram.svg
python3 scripts/ste_lint.py --extract-only document.html
python3 scripts/ste_lint.py --dump-extracted extracted.json document.html
python3 scripts/ste_lint.py --include-headings document.html
python3 scripts/ste_lint.py --skip-svg-labels document.html
python3 scripts/ste_lint.py --skip-accessibility-text document.html
```

## Acceptance checks

1. CSS declarations produce no findings.
2. scripts, code blocks, comments, and hidden subtrees produce no findings.
3. SVG geometry produces no words or findings.
4. SVG descriptions remain in scope.
5. SVG labels remain separate.
6. labels do not receive prose-only findings.
7. non-English blocks are excluded and counted.
8. inline literals stay exact and count as one token.
9. accessibility content has a distinct form.
10. every HTML or SVG finding has a source line and structural location.
11. no finding excerpt contains markup or styling syntax.
12. standalone SVG is auto-detected and respects `xml:lang`.
13. standalone labels remain in scope without duplicating inline prose.
14. adjacent inline elements do not join words.
15. plain-text and Markdown tests continue to pass.
