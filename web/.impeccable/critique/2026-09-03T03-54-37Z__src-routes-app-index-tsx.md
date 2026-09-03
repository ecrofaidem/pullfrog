---
target: Runs page
total_score: 13
max_score: 36
na_heuristics: 5
p0_count: 1
p1_count: 3
target_identity: "file:/home/tristan/Projects/pullfrog/web/src/routes/_app/index.tsx"
target_fingerprint: "sha256:4d308d54ed9323811017f3f58d23af7dd7e8bff9635d34244447cf46a07d8606"
target_path: /home/tristan/Projects/pullfrog/web/src/routes/_app/index.tsx
timestamp: 2026-09-03T03-54-37Z
slug: src-routes-app-index-tsx
---
Method: dual-agent (A: opus design review · B: opus detector/browser evidence)

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 1 | dispatches read `dispatched` with a ticking 11h elapsed while HEAD says healthy |
| 2 | Match System / Real World | 2 | result row rendered above its cause; raw kind "Pullfrog" as title |
| 3 | User Control and Freedom | 2 | no filter/search/per-PR view |
| 4 | Consistency and Standards | 2 | one review = two rows in two vocabularies |
| 5 | Error Prevention | n/a | read-only surface |
| 6 | Recognition Rather Than Recall | 1 | 9 identical "Actions log" links, anonymous result rows |
| 7 | Flexibility and Efficiency | 1 | no keyboard path, silent 100-row cap |
| 8 | Aesthetic and Minimalist | 2 | half the rows earn no pixels; JSON error is the loudest text |
| 9 | Error Recovery | 1 | raw GitHub 404 payload, no next action |
| 10 | Help and Documentation | 1 | no glyph legend; EmptyRail copy unreachable |
| **Total** | | **13/36** | **Poor** (mostly the double-row data defect, fixed server-side during this run) |

Design specificity: authored (the rail is an invention), but its thesis of linkage was unproven on screen because dispatch→result rows were never joined. Detector: 2 advisory false positives (root font-size, ::selection colour). Browser: mobile horizontal overflow 611px at 390 from unbroken run.error (index.tsx:276); hydration mismatch on every load from Date.now() in render; zero headings in the document.

Priority issues:
- [P0] Two rows per review, answer split from question — FIXED server-side (dispatch.ts resolves the API run title; prod relinked 18→11 rows).
- [P1] kindLabel default returns raw kind ("Pullfrog") at title weight (index.tsx:291).
- [P1] Open runs count up forever; no "no result" state (index.tsx:212). Needs a stale-run sweep cron.
- [P1] run.error overflows the phone viewport; raw JSON at full ink (index.tsx:276).
- [P2] No pending UI on tab switch; active tab flips before content.
Minor: ink-2/ink-3 indistinguishable in light; relative times never tick; 20–23px tap targets; no h1; 9 identical link names; ref pill affordance 1.26:1.
