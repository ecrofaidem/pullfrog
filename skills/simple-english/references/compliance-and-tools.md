# Compliance and tools

## What strict review requires

ASD-STE100 Issue 9 contains writing rules and a controlled dictionary. A complete vocabulary review also needs the organization's approved technical nouns and verbs.

Record whether these resources are available:

- official ASD-STE100 Issue 9
- project glossary or terminology database
- source facts and technical owner
- applicable safety, legal, or style directives
- source adapter and extraction preview for structured files

When the dictionary or glossary is unavailable, state:

> Structural STE review complete. Vocabulary compliance was not verified.

## What automation can check

A format-aware checker can separate static human-facing HTML and standalone or embedded SVG text from implementation syntax, report scope, retain locations, and find sentence-length, contraction, semicolon, verb-form, passive-voice, terminology, paragraph, and condition candidates.

It cannot reliably determine factual truth, approved word meaning, valid project terminology, task-logic condition order, unknown actors, paragraph coherence, warning severity, semantic fidelity, final browser rendering, runtime-generated text, or complete accessibility-tree correctness.

Treat heuristic results as review evidence. Treat extraction preview as scope evidence, not proof that every rendered string was inspected.

## Approved language

Use:

- `STE-based rewrite`
- `Structural review passed for the checked scope`
- `Vocabulary not verified`
- `Static HTML extraction complete`
- `Runtime-generated text not checked`
- `No unresolved issues found in the checked scope`

Do not use `certified`, `ASD-approved`, `officially compliant`, `guaranteed compliant`, or `the tool proves compliance`.

This package does not bundle the official standard or dictionary. Obtain them from the official STEMG site and follow distribution terms.

- https://agentskills.io/specification
- https://agentskills.io/skill-creation/best-practices
- https://www.asd-ste100.org/
- https://www.asd-ste100.org/STE_downloads.html
- https://www.asd-ste100.org/STE_faq.html
- https://www.asd-ste100.org/STEsoftware.html

Issue basis: ASD-STE100 Issue 9, dated 2025-01-15.
