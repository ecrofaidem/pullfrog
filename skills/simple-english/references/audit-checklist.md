# Audit checklist

## 1. Scope and evidence

- What source files and language regions are in scope?
- What is the source format?
- Is the review structural, vocabulary-based, or both?
- Are the official Issue 9 standard, project glossary, source facts, and applicable safety or legal directives available?

For structured source, record included human-facing content, excluded implementation and language regions, accessibility scope, and runtime content that cannot be inspected statically.

## 2. Extraction pass

For HTML and SVG confirm that:

- the source was parsed, not stripped with regular expressions
- CSS, scripts, templates, comments, preformatted code, hidden content, and ordinary attributes are excluded
- SVG geometry, coordinates, definitions, and presentation data are excluded
- SVG `<title>` and `<desc>` remain in scope
- each SVG `<text>` element is separate
- non-English blocks are excluded and counted
- inline code remains exact and counts as one token
- duplicate visible and accessibility text is not reported twice
- every block has a source line and structural location
- no finding excerpt contains markup or styling syntax

Use `--extract-only` for unfamiliar structured input.

## 3. Fidelity pass

- Facts, numbers, dates, identifiers, units, conditions, and exceptions match.
- No unsupported cause, fix, owner, promise, risk, or commitment appears.
- Modal force and uncertainty are preserved.
- Safety and legal qualifications remain intact.
- Fixed literals remain exact.
- Structural edits do not damage markup, links, identifiers, or accessibility relationships.

Resolve fidelity findings before style findings.

## 4. Type and form pass

- Prose blocks have the correct procedural, descriptive, note, or safety type.
- Prose and accessibility descriptions use the full profile.
- Labels and accessibility labels use the lighter profile.
- Label fragments are not treated as paragraphs.
- Conditions appear before dependent actions only when the reader needs them first.

## 5. Terminology and grammar pass

- One term identifies one concept.
- Project terms and literals are consistent.
- Strict dictionary and project-glossary status is recorded.
- Procedures use imperative commands and no more than 20 words per strict sentence.
- Descriptions and notes use no more than 25 words per strict sentence and six sentences per paragraph.
- Passive voice, tense, `-ing` clauses, contractions, semicolons, and lists are reviewed under the applicable profile.
- Safety labels and consequences are preserved.

## 6. Mechanical pass

```bash
python3 scripts/ste_lint.py --extract-only PATH
python3 scripts/ste_lint.py --input-format auto --type mixed PATH
```

Add `--strict` for a strict structural review. Review every result in context. A zero-result run does not prove compliance.

## 7. Delivery pass

For a structured audit, include:

```text
Input format: ...
Included scope: ...
Excluded scope: ...
Not statically checked: ...
```

For a compliance review, include:

```text
Review scope: structural / vocabulary / both
Structural status: pass / fail / open items
Official Issue 9 dictionary checked: yes / no
Project glossary checked: yes / no
Unresolved decisions: none / list
Conclusion: No unresolved issues found in the checked scope. This is not a certification or ASD endorsement.
```
