---
name: simple-english
description: "Use this skill to write, rewrite, or audit technical documentation with ASD-STE100 Simplified Technical English or an STE-based clarity mode. Apply it to procedures, runbooks, troubleshooting, API and CLI documentation, release notes, error messages, incident reports, maintenance instructions, translation-ready technical content, and HTML or SVG documents whose human-facing text must be separated from implementation markup. Always use it for a writing, rewriting, or audit request that mentions STE, ASD-STE100, controlled technical English, an STE compliance review, or technical writing for non-native readers. Do not activate for ordinary conversation, creative writing, or marketing unless the user explicitly requests STE."
license: MIT
metadata:
  version: "3.0.0"
  standard-basis: "ASD-STE100 Issue 9 (2025-01-15)"
  status: "Unofficial writing aid; not a compliance certification"
---

# Simple English

Write accurate technical text that a reader can understand on the first reading. Preserve meaning before you simplify style.

## Non-negotiable requirements

1. **Do not invent information.** Do not add unsupported causes, fixes, dates, measurements, requirements, risks, actions, or commitments.
2. **Preserve semantic force.** Keep obligations, recommendations, permissions, capabilities, possibilities, uncertainty, and future commitments distinct. Do not silently change `should` to `must`, `may` to `can`, or uncertainty to certainty.
3. **Preserve safety and legal meaning.** Keep mandated wording, risk levels, legal qualifications, and regulatory terms. Change them only with authorization.
4. **Preserve fixed literals.** Keep code, commands, identifiers, paths, values, product names, log excerpts, and quoted interface text exact. When a string is the rewrite target, edit its prose but preserve embedded literals.
5. **Preserve the requested artifact.** Keep the source format, hierarchy, links, citations, data, and implementation structure unless the user requests a change.
6. **Separate content from implementation.** Never apply sentence rules directly to markup, CSS, executable code, serialized data, or SVG geometry. Extract human-facing language first and report what was included and excluded.
7. **Do not claim certification.** A checker or language model cannot certify ASD-STE100 compliance. Strict vocabulary review also needs the official dictionary and the applicable project glossary.

Read [meaning and modality](references/meaning-and-modality.md) when the source contains requirements, recommendations, permissions, uncertainty, safety text, legal text, or commitments.

## Select the operation and mode

Identify the operation:

- **Write:** Create technical text from supplied facts and requirements.
- **Rewrite:** Improve supplied text without changing its meaning.
- **Audit:** Find issues and propose corrections without silently replacing the source.

Use one mode:

- **STE-based mode (default):** Apply high-value structural and terminology practices. Keep necessary domain language. Treat sentence limits as strong targets when a fixed literal or semantic constraint prevents a clean split.
- **Strict review mode:** Use when the user asks for STE, ASD-STE100, strict compliance, rule numbers, or a compliance audit. Check vocabulary against the official Issue 9 dictionary and project glossary when available. Otherwise, report a structural review and state that vocabulary compliance was not verified.

Read [compliance and tools](references/compliance-and-tools.md) for a strict review or compliance claim.

## Workflow

### 1. Establish the source of truth

Before a rewrite, identify:

- facts and data
- actors and actions
- sequence and conditions
- obligation and uncertainty
- safety or legal qualifications
- fixed literals

Do not fill a gap with a plausible fact. Use neutral wording, mark the gap, or ask only when the missing fact prevents a safe result.

### 2. Determine the source format and checked scope

Classify the source as plain text, Markdown, HTML, standalone SVG, or another structured format before mechanical review.

For HTML or SVG:

- parse the document; do not remove tags with regular expressions and join the result
- ignore CSS, scripts, templates, preformatted code, comments, hidden content, ordinary attributes, and SVG geometry
- review visible prose and accessibility descriptions with the prose profile
- review interface text, standalone links and short labels, optional headings, SVG titles, and SVG text nodes with the label profile
- keep each SVG `<text>` element separate
- exclude non-English subtrees from an English run and report the exclusion
- retain source lines and DOM-like locations
- preserve inline `<code>`, `<kbd>`, `<samp>`, and `<var>` as fixed literals

Read [source-format handling](references/source-format-handling.md) before auditing HTML, SVG, generated documentation, or another mixed-content source.

### 3. Classify each language block

Keep **semantic type** separate from **content form**.

| Semantic type | Purpose | Main form | Strict sentence limit |
|---|---|---|---|
| Procedural | Tells the reader what to do | Imperative command | 20 words |
| Descriptive | Explains a system, state, event, or result | Simple present, past, or future | 25 words |
| Note | Gives information inside a procedure | Descriptive, not imperative | 25 words |
| Safety instruction | Prevents injury, death, or damage | Risk label plus command or condition | 20 words |

Content forms:

- **Prose:** Apply sentence, paragraph, tense, voice, logic, and terminology checks.
- **Accessibility description:** Apply the prose profile and report it separately.
- **Label or accessibility label:** Apply terminology, contraction, modal, promotional-language, and excessive-length checks. Do not apply paragraph, passive-voice, tense, ordinary semicolon, or multiple-instruction heuristics to a fragment merely because it contains those forms.
- **Literal:** Preserve it and exclude it from language rules.

A document can contain several types and forms. Read [the application guide](references/ste-application-guide.md) for the detailed rule map.

### 4. Control terminology

- Use one established term for one concept throughout the checked scope.
- Keep project terms, API names, and domain terms.
- Do not rotate synonyms only for variety.
- Break unclear noun chains.
- In strict review mode, distinguish approved dictionary words from project technical nouns and verbs.
- Do not assume that an unfamiliar word is prohibited; it can be a valid project term.

### 5. Draft the text

For procedural blocks:

- Use the imperative.
- Put one instruction in each sentence, unless actions must occur at the same time.
- Put a condition first only when the reader must know it before the instruction.
- Keep prerequisites before dependent steps.
- Use notes for information, not hidden instructions.

For descriptive blocks:

- Give information gradually.
- Put one topic in each paragraph.
- Use no more than six sentences in a paragraph in strict review mode.
- Prefer active voice. Passive voice can be valid when the actor is unknown or genuinely irrelevant.

For all prose:

- Prefer simple verb forms and direct verbs.
- Avoid perfect and progressive constructions when a simple tense keeps the meaning.
- Replace an ambiguous `-ing` clause with a complete sentence.
- Use complete grammar.
- Use `that` only when it prevents ambiguity.
- Do not use contractions or semicolons in strict review mode.
- Use lists when they improve scanning.
- Follow the project's spelling directive; otherwise, use American English. Keep quoted spelling unchanged.

For safety instructions:

- Use the risk label required by the user's domain or style guide.
- Start with a clear command or necessary condition.
- State the supported risk or result after it.
- Never invent a hazard or change its severity.

Read [use cases](references/use-cases.md) for specialized patterns.

### 6. Validate in this order

1. Facts, numbers, conditions, actors, and commitments.
2. Modality and uncertainty.
3. Source-adapter scope.
4. Semantic type, content form, and information order.
5. Terminology consistency.
6. Applicable sentence, paragraph, voice, contraction, semicolon, and literal checks.
7. Dictionary and project-glossary status in strict review mode.

Run the format-aware checker when tools are available:

```bash
python3 scripts/ste_lint.py --input-format auto --type mixed PATH
```

For strict review, add `--strict`. Inspect extraction scope first for structured or unfamiliar input:

```bash
python3 scripts/ste_lint.py --extract-only PATH
python3 scripts/ste_lint.py --dump-extracted extracted.json PATH
```

The checker finds mechanical issues and review candidates. It does not make a compliance decision. Use [the audit checklist](references/audit-checklist.md) after it.

## Output requirements

For a **write** or **rewrite**, return the finished text without a lecture unless the user asks for an explanation. State unresolved meaning problems briefly.

For an **audit**, report:

1. location or quoted excerpt
2. issue
3. applicable rule or principle
4. proposed rewrite
5. confidence or required decision

Separate objective mechanical findings from judgment calls. For a structured source, also state the input format, included content, excluded regions, and runtime content that could not be checked.

For a **compliance review**, end with:

- structural review: pass, fail, or open items
- official dictionary checked: yes or no
- project glossary checked: yes or no
- unresolved meaning or terminology decisions

Use **“No unresolved issues found in the checked scope.”** Do not use **“certified,” “ASD-approved,”** or **“guaranteed compliant.”**
