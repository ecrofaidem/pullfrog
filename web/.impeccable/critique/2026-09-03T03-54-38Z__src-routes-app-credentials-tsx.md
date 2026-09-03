---
target: Credentials page
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:/home/tristan/Projects/pullfrog/web/src/routes/_app/credentials.tsx"
target_fingerprint: "sha256:c41b8b8457f221a75e97d3dd546216ed7da9226453fedaaef4a4329a477cefa7"
target_path: /home/tristan/Projects/pullfrog/web/src/routes/_app/credentials.tsx
timestamp: 2026-09-03T03-54-38Z
slug: src-routes-app-credentials-tsx
---
Method: dual-agent (A: opus design review · B: opus detector/browser evidence)

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | "Refreshed 13h ago" for a chain that never refreshed |
| 2 | Match System / Real World | 3 | four names for one object; CODEX_AUTH_JSON never named |
| 3 | User Control and Freedom | 3 | no copy for the command; no next step when healthy-but-failing |
| 4 | Consistency and Standards | 2 | page state and banner state from two functions; can disagree |
| 5 | Error Prevention | 2 | remove button's busy never resets on failure |
| 6 | Recognition Rather Than Recall | 3 | scope chosen in terminal never echoed |
| 7 | Flexibility and Efficiency | 2 | reseed command not focusable, no copy button |
| 8 | Aesthetic and Minimalist | 2 | ~90 words + dl + command + empty section to say "fine" |
| 9 | Error Recovery | 3 | cut state is the best-designed thing in the build |
| 10 | Help and Documentation | 3 | over-served on the healthy path |
| **Total** | | **25/40** | **Acceptable** |

Design specificity: authored but weakest carrier of the world; the rail vocabulary evaporates below the top 100px; a page about a rotating chain shows no rotation. Detector/browser: 94-char lines, 11.7px dd text, tight leading on the command, hydration mismatch on load, no h1.

Priority issues:
- [P0] `lastRefreshAt ?? updatedAt` asserts a refresh that never happened, 30px from "not yet (seeded only)" (credentials.tsx:90, health.ts:56).
- [P1] Healthy state over-explains; verdict below two headings in weight (credentials.tsx:62-116).
- [P1] Page ignores the banner's `warn` kind: "Last 3 runs failed" above "Healthy." with no reconciliation (credentials.tsx:57).
- [P2] Command not focusable, no copy, breaks mid-token with break-all (credentials.tsx:110).
- [P2] Empty "Other secrets" section closes the visit on a chore (credentials.tsx:32-49).
Minor: same cut glyph for missing and rejected; mono on human prose at :96; run-state glyph reused as bullet at :131; unclamped refreshRejectedReason.
