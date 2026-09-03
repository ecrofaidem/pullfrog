---
target: Settings page
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/tristan/Projects/pullfrog/web/src/routes/_app/settings.tsx"
target_fingerprint: "sha256:67e51770224cdf45f793ab6078f699b2a68d9e91dd15a3c1e0639c6cad281661"
target_path: /home/tristan/Projects/pullfrog/web/src/routes/_app/settings.tsx
timestamp: 2026-09-03T03-54-37Z
slug: src-routes-app-settings-tsx
---
Method: dual-agent (A: opus design review · B: opus detector/browser evidence)

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | "saved just now" frozen; no per-field dirty marker |
| 2 | Match System / Real World | 2 | mono key namespace exists only in this file, three naming conventions |
| 3 | User Control and Freedom | 2 | no unsaved-changes guard; Enter submits whole form |
| 4 | Consistency and Standards | 2 | `.field { w-full }` outside @layer kills every w-* utility: all 17 controls 411px |
| 5 | Error Prevention | 1 | zero client validation; no confirm on kill switch / push:enabled |
| 6 | Recognition Rather Than Recall | 3 | `disabled` tier unexplained |
| 7 | Flexibility and Efficiency | 2 | no ⌘S, no anchors on a 2,067px form |
| 8 | Aesthetic and Minimalist | 3 | always-mounted sticky bar occludes live controls |
| 9 | Error Recovery | 1 | raw Convex stack trace with Request ID; aria-invalid never set |
| 10 | Help and Documentation | 3 | best layer: consequence-naming, computed "1 allowed" |
| **Total** | | **21/40** | **Acceptable (bottom)** |

Design specificity: authored world, borrowed costume — the git-config mono keys borrow git's authority without its contract. Detector: none on this page beyond the disabled Save button at 4.49:1 (WCAG-exempt). Browser: 8 of 17 controls have no accessible name; checkboxes 16px, radios 13px.

Priority issues:
- [P1] Sticky bar always mounted, opaque, occludes controls (settings.tsx:227).
- [P1] Failed save shows a Convex stack trace, never marks the field (settings.tsx:113-125).
- [P1] 8 unnamed form controls; key is a div not a label (settings.tsx:267).
- [P2] Kill switch / push:enabled / everyone render identically to trivia; no confirm.
- [P2] `.field` width override defeats field sizing (styles.css:72).
Minor: provenance hidden exactly when dirty; concurrent edits clobbered silently; no autoCapitalize off on mobile; empty "Repository" hint; effort 0 vs "" ambiguity.
