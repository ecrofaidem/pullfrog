# Evaluation guide

Version 3 separates activation quality, writing quality, and structured-source extraction quality.

## Trigger evaluation

`trigger-evals.json` contains 23 realistic queries: 12 should trigger and 11 should not. The v3 cases distinguish STE audits of HTML and standalone SVG from CSS or SVG implementation optimization.

Run each query repeatedly. Optimize on train cases and report validation without tuning on it. Track true-positive rate, false-positive rate, precision, recall, and per-query consistency.

## Output-quality evaluation

`evals.json` contains 17 cases. The v2 cases cover invention, modality, uncertainty, fixed literals, mixed blocks, condition logic, safety, passive voice, spelling directives, release notes, and audit structure.

The v3 cases add:

- HTML extraction scope
- SVG accessibility and label profiles
- non-English exclusion
- inline-code handling
- structural locations
- standalone SVG detection

Run each case in matched without-skill or previous-version and with-v3 conditions.

## Structured-source grading order

1. No finding comes from CSS, scripts, markup, or SVG geometry.
2. Visible prose remains in scope.
3. Accessibility descriptions remain in scope.
4. Labels remain separate and use the lighter profile.
5. Non-English and hidden regions are excluded and reported.
6. Fixed literals remain exact and do not create findings.
7. Standalone labels and inline word boundaries are preserved.
8. Locations identify usable source elements.

A lower finding count is not sufficient if real accessibility content was discarded.

Then grade factual fidelity, safety and legal preservation, required output, type and form classification, structural STE findings, readability, and concision.

Strict vocabulary grading requires the official Issue 9 dictionary and project glossary. Do not claim benchmark results without recorded protocol, raw outputs, sufficient repeats, and model and harness versions.
