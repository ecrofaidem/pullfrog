---
version: 1
slug: "src-routes-app-index-tsx"
primary_target: "src/routes/_app/index.tsx"
related_targets: ["src/routes/_app/settings.tsx","src/routes/_app/credentials.tsx"]
---

# Runs (primary), Settings, Credentials

Scope: the frogbot dashboard, Operate mode. Audience: ecrofaidem engineers, short visits, often on a phone. Task: see whether a review ran, change who gets reviewed, confirm the Codex chain is healthy. Proof: real run rows from Convex; nothing synthetic. Constraints: no mascot, no stat tiles, no decorative charts; both colour schemes; status by shape and text, never colour alone.

## Direction contract

THESIS: Runs are commits on a rail; the rail's continuity is the health of the system. Refuses the card grid with stat tiles and a sidebar.

OWN-WORLD: Cool near-white sheet (dark: graphite), achromatic ink for all text, one indigo rail hue worn only by the in-progress run and the rail itself; a mono face for refs, times and counts; five state glyphs (dot, rotating ring, crossed dot, hollow, slashed); sections divided by gaps, never boxes.

STORY: The visitor reads HEAD first: unbroken rail, reviews flow. A cut rail names the failure and the one command that fixes it. Then they scan down for their PR.

FIRST VIEWPORT: One 72ch column. Top strip: `ecrofaidem/monorepo` as a mono ref, tabs Runs · Settings · Credentials. Rail at the column's left edge from a HEAD marker (health) down through nodes; each row: PR ref pill, title, kind, triggerer, elapsed, tokens; links to PR and Actions log at row end.

FORM: Git Graph Rail, candidate 3 of 7, seed c4794c9d. Signature interaction: a new run arrives at HEAD and the rail draws down to it; the in-progress ring rotates.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
