---
name: frogbot
description: A git graph as a control surface — runs are commits on a rail, and the rail's continuity is the health of the system.
colors:
  sheet: "light-dark(#f4f5f7, #14161a)"
  sheet-2: "light-dark(#eceef2, #1b1e24)"
  ink: "light-dark(#15181d, #e6e8ec)"
  ink-2: "light-dark(#4e5561, #a3aab4)"
  ink-3: "light-dark(#666d79, #8b929c)"
  hair: "light-dark(#d9dce2, #2a2e35)"
  rail: "light-dark(#5b5bd6, #8b8bff)"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: "1.75rem"
    letterSpacing: "-0.01em"
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: "1.5rem"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: "1.5rem"
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  caption:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1rem"
  mono:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "0.9em"
    fontWeight: 400
    fontFeature: "tabular-nums"
rounded:
  sm: "4px"
  focus: "2px"
  pill: "999px"
spacing:
  rail-gutter: "8px"
  row: "12px"
  page-gutter: "20px"
  main: "28px"
  section: "40px"
  section-major: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-primary-disabled:
    backgroundColor: "{colors.sheet-2}"
    textColor: "{colors.ink-3}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  field:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
  field-disabled:
    backgroundColor: "{colors.sheet-2}"
    textColor: "{colors.ink-3}"
  checkbox:
    size: "16px"
  ref-pill:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-2}"
    typography: "{typography.mono}"
    rounded: "{rounded.pill}"
    padding: "0 6px"
    height: "20px"
  command:
    backgroundColor: "{colors.sheet-2}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "4px"
    height: "24px"
  tab-active:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
  bone:
    backgroundColor: "{colors.sheet-2}"
    rounded: "{rounded.sm}"
---

# Design System: frogbot

## Overview

**Creative North Star: "The Git Graph Rail"**

frogbot renders the state of a review bot the way git renders history: a vertical hairline down the left edge, a node on it for every run, and a HEAD marker at the top that says in one sentence whether anything is flowing. The rail is not decoration around the data — it *is* the reading order. A visitor lands, reads HEAD, and either sees an unbroken line (reviews are running) or a line that has gone dashed and grey below a struck-through HEAD (the credential is dead, and the one command that fixes it is right there, with a copy button beside it). Only then do they scan down for their own PR. Every screen in the product is a variation on that one gesture.

The world is achromatic by construction. Text, borders, glyphs, buttons and dividers are all ink on a cool near-white sheet (graphite in dark scheme); a single indigo is the only hue in the system, and it is worn exclusively by the rail, the run that is in flight, and the browser affordances that belong to the rail's job (focus ring, selection, caret, checkbox accent). Nothing turns red when it fails and nothing turns green when it succeeds — a failed run is a ring with a cross through it and the word "failed", a done run is a filled dot and the word "done", a run that has gone quiet past its timeout is a dashed ring and the words "no result yet". This is an accessibility commitment (status by shape and text, never colour alone) that the build kept without a single exception, and it is also what makes the one indigo legible: when the only colour on the page is the rail, the eye goes to the rail.

Density is high and the chrome is nearly absent. One 72ch column, no sidebar, no cards, no stat tiles, no panels. Sections are separated by vertical gap and, at most, a hairline rule; nothing in this product is ever put in a box. A system sans carries prose and a system mono carries everything the machine owns — repo names, refs, logins, elapsed times, token counts, setting keys, shell commands — so a glance can tell language from data without reading either. The page also refuses to make the reader parse machine spew: a failed run states its failure as an English sentence and keeps the raw text behind a disclosure. It is a tool for people who visit for forty seconds on a phone, and the layout is the same structure at 390px as at 1440px: the column narrows, the rail stays.

**Key Characteristics:**
- One 72ch column; the rail runs down its left edge on every view
- Achromatic ink plus exactly one indigo, confined to the rail and the in-flight run
- State is a glyph plus a word, never a hue
- Flat: no surface floats, and the only `box-shadow` in the system draws a 1px underline
- Gaps and hairlines divide; boxes never do
- System sans for prose, system mono for machine text
- The machine's raw output lives behind a disclosure; the surface speaks in sentences
- Loading shows the shape of the content, never a spinner
- Motion only ever reports server state

## Colors

A cool achromatic sheet with a five-step ink ramp, plus one indigo that the rest of the palette exists to make loud.

### Primary
- **Rail Indigo** (light `#5b5bd6` / dark `#8b8bff`): the only hue in the product. It draws the rail hairline, the rotating in-progress ring and its "in progress" label, the solid core of a healthy HEAD, the bezier lanes that link an incremental review back to the review it extends, the focused field's border, and the browser surfaces the rail owns — `:focus-visible` outline, `::selection`, `accent-color` (so checkboxes and radios come up indigo), `caret-color`. It appears nowhere else and never as a fill behind text.

### Neutral
- **Sheet** (light `#f4f5f7` / dark `#14161a`): the page ground and the fill of every input. Also painted behind each glyph cell so the rail passes *behind* the nodes rather than through them, and behind the settings save bar so it can sit sticky over scrolling content without a shadow.
- **Sheet Shade** (light `#eceef2` / dark `#1b1e24`): the only tonal step, and it means *inert*. It fills command blocks, disabled controls, skeleton bars, and the health banner's hover state — things that are present but not typed into.
- **Ink** (light `#15181d` / dark `#e6e8ec`): primary text, run titles, state glyphs, the active tab's underline, the primary button's fill, and the full-weight voice a message takes when something needs attention (a validation error, a save failure, a concurrent-edit conflict).
- **Ink Muted** (light `#4e5561` / dark `#a3aab4`): secondary text — labels, state words, metadata, inactive tabs, setting keys, help sentences, the ref pill. The step was pushed darker in light scheme and lighter in dark so this workhorse tone clears contrast at 0.8125rem; it is now the tone that carries most of the reading on a settings page.
- **Ink Faint** (light `#666d79` / dark `#8b929c`): tertiary text — timestamps, durations, model ids, token counts, per-setting help, disabled state, non-run list dots — and the hover border of an unfocused input.
- **Hairline** (light `#d9dce2` / dark `#2a2e35`): every border and divider in the product, the skeleton rail, and the scrollbar thumb.

### Named Rules

**The Rail-Only Hue Rule.** Indigo is worn by the rail, by the run currently in flight, and by the browser affordances the rail owns. Nothing else in the product is ever coloured. If a new element wants the accent, it must first be part of the rail's story.

**The Never-By-Colour Rule.** No state in this system is signalled by hue. Failure is a struck ring plus the word "failed" in full-strength ink; a stall is a dashed ring plus "no result yet"; a destructive button announces itself by its border going dashed on hover, not by turning red. Attention is spelled with ink weight — muted text goes full ink and medium weight — never with a colour. There is no red, green or amber token, and adding one breaks the world.

**The Two-Surface Rule.** There are exactly two backgrounds: the sheet, and one shade of it for everything inert — command blocks, disabled controls, skeleton bars, the health banner's hover. A third surface tone means someone is building a card.

## Typography

**Body Font:** system-ui (with -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif)
**Label/Mono Font:** ui-monospace (with SF Mono, Menlo, Consolas, Liberation Mono, monospace)

**Character:** Two system stacks and nothing else — no webfont is loaded, so the first paint is the final paint. The pairing does the product's core job: sans is what a person wrote, mono is what the machine owns. Tabular figures are on globally, so times and token counts hold their columns as rows update live.

### Hierarchy

There is no display tier. The ramp tops out at 1.25rem and the sizes sit close together; hierarchy here comes from weight, ink step and position on the rail, not from scale.

- **Headline** (600, 1.25rem/1.75rem, -0.01em): the product name on sign-in. One per document, and most views have none.
- **Title** (600, 1.0625rem/1.5rem, -0.01em): section headings — "Repository", "Review policy", "Model", "Run", "Codex subscription". The only other bold text in the product.
- **Body** (400, 0.9375rem/1.5rem): run titles, HEAD's sentence, the repo's full name, secret names, prose. Capped at 48–60ch inside the 72ch column.
- **Label** (400, 0.8125rem/1.25rem): the workhorse — state words, run metadata, setting keys, help text under every setting, button text, nav tabs, disclosure summaries.
- **Caption** (400, 0.75rem/1rem): ref pills and command blocks only.
- **Mono** (0.9em of its context, tabular): a face switch applied at any size, not a size of its own.

### Named Rules

**The Machine-Text-Is-Mono Rule.** If GitHub or the server owns the string, it is set in mono: `owner/repo`, `#1318`, a login, a relative time, an elapsed duration, a model id, a token count, a setting key (`review.authors`), a secret name, a shell command. If a person wrote it — a PR title, a help sentence, a heading — it is sans. Mixed baselines in one row are expected and correct.

**The No-Display Rule.** Nothing is set above 1.25rem. This product has no hero, no marketing voice and no title card; a page that needs bigger type is a page that has stopped being a control surface.

**The Lowercase-Machine Rule.** State words and control labels are lowercase (`in progress`, `done`, `failed`, `no result yet`, `sign out`, `remove`, `turn off`, `copy`, `allowlist`); headings, buttons that commit (`Save changes`, `Discard`, `Keep`, `Turn off`) and full sentences are sentence case. Nothing is uppercased or letter-spaced for effect.

**The Plain-Sentence Rule.** Server output is rewritten for a person before it is shown: "GitHub returned 404 while dispatching the workflow. The workflow file may be missing from the default branch." The raw string is never the first thing on screen — it goes behind a `raw error` disclosure, in a command block, at caption size.

## Layout

One centred column, `max-width: 72ch`, with a 20px page gutter and 20px of top padding (28px from the `sm` breakpoint, 640px). The column is the entire layout: there is no sidebar, no second column, no grid of tiles. Content starts 28px under the header, and 96px of dead space sits below the column so the last run is never flush against the viewport edge.

Inside the column, everything is the same two-track grid: **a 28px glyph column, an 8px gap, then content** (`grid-cols-[28px_1fr] gap-x-2`). The rail hairline sits at the centre of that first track (x = 14px) and runs the full height of the list, inset 12px top and bottom. Rail rows, the HEAD block, the health banner on other views, credential secrets, the "no other secrets" one-liner, the empty state and the loading skeleton all share this grid, which is why the rail reads as continuous across content of wildly different heights. Rows are 12px of vertical padding; the glyph cell is 24px tall so the node aligns to the first line of its row.

Sections are separated by vertical distance, not containment: 40px between settings groups, 48px between major credential sections, 28px between the header and main content. Within a settings group, rows are divided by hairlines top, bottom and between (`divide-y` inside a `border-y`) — a rhythm of rules, never a bordered box.

**Responsive behavior.** There is one breakpoint (`sm`, 640px) and it changes three things: top padding grows, the settings row goes from stacked to an `11rem` key column beside its control, and the settings save bar stops bleeding to the viewport edge. Everything else reflows on its own — header, run metadata and control rows are all `flex-wrap` with baseline alignment, so a phone gets the same structure at a taller rhythm. The mobile view is not a separate layout; it is the same column, narrower.

**Measure.** Prose is capped tighter than the column: 60ch for settings forms, credential content, health detail and run errors; 56ch for the empty state and for credential asides; 48ch for the introductory paragraph on an unconfigured account.

**Touch.** Every small text control — nav tabs, `sign out`, `remove`, `turn off`, `Actions log`, disclosure summaries — carries a minimum 24px hit area with 4px of padding, pulled back out of the flow with an equal negative margin so the target grows without moving anything around it.

### Named Rules

**The One-Column Rule.** Every view is one 72ch column. Anything that wants a sidebar, a split pane or a tile grid is refused; if it needs to sit beside something, it goes further down the rail.

**The Gap-Not-Box Rule.** Sections are separated by vertical space and at most a hairline rule. No card, no panel, no bordered container, no elevated surface. The only rectangles with a fill in this product are command blocks, form controls and skeleton bars.

**The 28px Gutter Rule.** Every list-shaped thing on every view uses the 28px glyph track, whether or not the rail is drawn behind it. That shared gutter is what makes Runs, Settings' health banner, Credentials and the loading skeletons feel like one surface.

**The Grown-Not-Moved Target Rule.** A hit area is enlarged with padding and cancelled with an equal negative margin. A control never gains touch size by pushing its neighbours around.

## Elevation & Depth

There is no elevation. Nothing in this system floats: no outer shadow, no blur, no scrim, no layered surface, no modal or popover on the page. The single `box-shadow` in the stylesheet is an *inset* one — `inset 0 -1px 0` on the active tab — and it is a rule, not a shadow: it draws the 1px underline inside the tab's own box so the underline can't disturb the tab's height or its hit area. Depth is otherwise conveyed three ways, all of them flat:

1. **Hairlines** separate; a 1px border in the hairline token is the only edge anything gets.
2. **One tonal step** distinguishes an inert surface (command block, disabled control, skeleton bar) from the sheet.
3. **Occlusion** does the one job that genuinely needs a z-axis: each glyph cell paints the sheet colour at `z-10`, so the rail hairline passes *behind* the node instead of striking through it, and the lane curves sit above both at `z-20` so a lane never disappears under a knockout. That is the whole depth model — opaque knockouts and one stacking order, no shadow implied.

### Named Rules

**The Flat Sheet Rule.** Nothing in this product casts a shadow. The only `box-shadow` allowed is an inset one standing in for a border that must not change an element's geometry. A component that needs to float is a component that does not belong on the rail.

**The Rail Passes Behind Rule.** Any element sitting on the rail must paint the sheet colour behind itself and raise its stacking context. The line must never appear to cross a glyph — and anything that must cross the knockouts (the lanes) goes above them, not through them.

## Shapes

Corners are almost square: 4px on inputs, buttons, command blocks, tabs and skeleton bars; 2px on the focus outline. The single exception is the **ref pill** (999px), which is fully round because it is quoting GitHub's own ref chip — roundness is reserved for that one borrowed object, and nothing else in the system is allowed it.

Borders are always 1px. The system uses **border style as a semantic**, not just border colour: solid is normal, and dashed means *broken, missing or dangerous*. A cut rail is a dashed 4-on-4-off gradient in faint ink; a rejected HEAD is a dashed ring struck through; a HEAD with no credential at all is the same dashed ring with nothing inside it; a run that has gone silent past its timeout is a dashed ring; an invalid field goes ink-coloured and dashed; a destructive button's border goes dashed on hover. Because the palette refuses red, the dash carries that meaning instead.

The glyph vocabulary is authored SVG on a 16×16 grid at a single 1.5 stroke weight, built from one primitive — a circle — modified: filled (done), dashed and rotating (in progress), crossed (failed), slashed (cancelled), finely dashed and still (stalled), hollow (queued/dispatched), and a small solid dot for list items that are not runs. HEAD is the same circle one step larger (r 5.5 vs 4.5) with four readings: ring plus core (ok), hollow ring (warn), dashed ring struck through (cut), dashed ring alone (missing). Small affordance icons — the outward arrow on an external link, the check on a completed action, the copy mark — are the same stroke weight on a 12×12 grid. Any new glyph must be that circle, modified, or that stroke weight on those two grids.

### Named Rules

**The Dashed-Means-Broken Rule.** A dashed border is never decorative. It means severed, absent, stalled, invalid or destructive, and it is how this achromatic system says what other systems say in red.

**The One-Stroke Rule.** Every icon and glyph is authored SVG on a 16×16 (or 12×12) grid at 1.5 stroke weight, drawn from the system's own circle primitive. No icon library, no icon font, no emoji. The one filled, non-stroke mark in the system is GitHub's own logo on the sign-in button, inlined as a path because it is a brand mark and not an icon.

## Components

### Buttons

Small, quiet, rectangular; a button here is a labelled edge, not an object.

- **Shape:** near-square corners (4px), 1px border always present, 12px × 6px padding, minimum 24px height, label type (0.8125rem, 500 weight), inline-flex with a 6px gap for an optional 12px glyph.
- **Primary:** full ink fill with sheet-coloured text and an ink border — the darkest thing on the page, used once per view (Save changes, Continue with GitHub). Hover drops opacity to 0.88; disabled swaps to the sheet shade with faint ink and a hairline border.
- **Quiet:** transparent fill, hairline border, ink text. Hover deepens the border to faint ink. This is the default for anything that is not the one committing action (Discard, Keep, Turn on, copy).
- **Danger:** identical to quiet at rest — no red, no fill. On hover the border goes to full ink *and turns dashed*. Destructive intent is confirmed inline, in the row it acts on ("remove SECRET_NAME?", "Turn frogbot off for this repo?"), with a quiet Keep beside it.
- **Text buttons:** for tertiary actions (sign out, remove, turn off, Take theirs) the button drops its border entirely and becomes underlined muted-ink text that darkens to full ink on hover, carrying the shared 24px hit area.

### Inputs / Fields

One class covers text inputs, textareas and selects, so a form reads as a single material.

- **Style:** sheet fill, 1px hairline border, 4px corners, body type, 10px × 6px padding. The class sets no width of its own beyond `max-width: 100%` — each field is given an explicit content-sized width at its use site (`w-28` for a timeout, `w-44` for a handle or a select, `w-72` for a model id, full width for a script textarea). The field's width is a hint about the value's size, and the class never forces one.
- **Hover:** border deepens to faint ink over 150ms.
- **Focus:** border goes rail indigo and the native outline is suppressed — the field joins the rail's colour while it is being edited. Everything else in the product keeps the global 2px indigo `:focus-visible` outline at 2px offset.
- **Disabled:** sheet-shade fill with faint ink text.
- **Invalid:** border goes full ink and dashed (`aria-invalid="true"`), with a full-ink sentence above the help text naming the accepted shape ("Use a length like 45m, 1h or 1h30m."). Validation runs before the round trip and focuses the first offending control. Never red.
- **Checkboxes and radios:** native controls at a flat 16px, tinted by the global indigo `accent-color`, always inside a `<label>` with its text at label size.
- **Mono variant:** any field holding machine text (handle, model id, timeout, allowlist, scripts) carries the mono class.

### Navigation

- **Style:** three inline text tabs (Runs · Settings · Credentials) in the header at label size, 12px apart, sitting on the baseline beside the repo's mono full name. When the account has more than one repo the name becomes a select in the field style, sized to its content.
- **States:** inactive is muted ink; hover goes to full ink; active is full ink with a 1px ink underline drawn as an inset shadow, so activating a tab shifts nothing.
- **Mobile:** the header simply wraps — repo name on one line, tabs and identity on the next. No hamburger, no drawer, no bottom bar.
- **Identity:** the signed-in login in mono, faint, pushed to the far end, with an underlined text "sign out" beside it.

### Settings Rows

- **Structure:** the config key on the left in mono muted ink, in an 11rem column, and it is a real `<label>` bound to its control; the control on the right; one sentence of help in faint ink directly beneath, bound to the control as its description. Below 640px the key stacks above its control.
- **Grouping:** four groups — Repository, Review policy, Model, Run — each a title, a one-line hint, then rows hairline-divided inside a hairline-bounded stack. No fieldset styling, no card. 40px between groups.
- **Kill switch:** the one setting that stops everything is not a checkbox. It reads "On" with an underlined `turn off` beside it; pressing that swaps the row inline for the question "Turn frogbot off for this repo?" with a danger button and a quiet "Keep on". Off reads as full-ink medium weight with a quiet "Turn on".
- **Commit:** a sticky bar at the bottom of the viewport with a hairline top border and a sheet fill, carrying the primary Save and a quiet Discard. **The bar exists only when it has something to say** — dirty, saving, failed, or saved in the last eight seconds — so a clean form has no chrome at the bottom at all. Dirty shows whose change you are about to overwrite; a concurrent edit turns that line full ink and offers "Take theirs"; a save failure is a full-ink "Not saved: …"; success is a check glyph and "Saved. The next run uses these settings."
- **Provenance:** below the groups, one faint paragraph naming who last changed the settings and the exact `GET`/`PATCH` endpoint that speaks the same keys.

### Command Block

A selectable shell command in the sheet shade at caption mono, 12px × 8px, 4px corners, focusable so a keyboard can reach it, `user-select: all` on the code itself. It wraps at spaces and breaks anywhere rather than scrolling sideways — a command that runs off the edge of a phone is not a fixable command. Where a command is the whole point of a section, a quiet copy button sits beside it and swaps its copy mark for a check and the word "copied" for 1.5s.

### Disclosure

The system's way of holding a second layer without a second surface: a `<details>` whose summary is an underlined muted-ink label at label size (native marker removed), going full ink when open. It carries the raw error text under a run's plain-sentence summary, and the reseed instructions on Credentials when the chain is healthy — the path that only matters sometimes is one click away, not on the page.

### Pending States

Loading is drawn as the shape of what is coming, in the sheet's second tone, pulsing opacity to 0.55 over 1.4s. `RailSkeleton` is the rail itself — a hairline line, four glyph cells, and two bars per row at descending widths. `SheetSkeleton` is a heading, a hint and three settings rows on the same 11rem grid. Both carry `aria-busy` and a label. Under reduced motion the pulse stops and the bars stand still. There is no spinner in this product.

### The Rail (signature component)

The product's one structural invention, and the thing every other view borrows from.

- **The line:** a 1px hairline in rail indigo at x = 14px, running from just under HEAD to just past the last node. When HEAD is cut or the credential is missing it becomes a 4-on-4-off dashed gradient in faint ink — the rail visibly breaks, and that break is the fastest signal on the page.
- **HEAD:** a larger ring at the top carrying one sentence of derived health. Healthy is a rail-indigo ring with a solid core plus a muted sentence ("chain rotated 3m ago · last run 13m ago"); a warning is the same ring hollow, in ink, with full-weight text and a link to the newest failed run's Actions log; a cut or missing chain is a dashed ink ring, struck through when it was rejected, followed by a detail paragraph and the exact reseed command in a command block. Health escalates the *weight and detail* of the same sentence — it never changes its colour or position.
- **Nodes:** one glyph per run, in ink, on a sheet-painted cell so the rail passes behind. The first run of a PR group carries the PR title as a link (underlining on hover) with the ref pill before it and the state word after; later runs of the same PR show what they are instead, so a title is never repeated down a group. Under that, a metadata line: kind, triggerer, relative time, elapsed, model, subscription marker, token counts and cost, and a link out to the Actions log. A failed run adds a plain sentence of what went wrong, with the raw text behind a disclosure.
- **Stalls:** a run still open 30 minutes past its start is drawn dashed and labelled "no result yet" with its elapsed frozen at the stall threshold — the page names the condition before the server's sweep gets to it.
- **Lanes:** an incremental review draws a rounded bezier from its node out to x = 26px, down, and back into the node of the nearest older run on the same PR — a 1px rail-indigo curve at 0.7 opacity, drawn above the glyph knockouts and measured from the live glyph positions so it survives reflow, font loading and resize.
- **On other views:** Settings and Credentials carry the same HEAD sentence as a one-line banner in the same 28px gutter, from the same subscription, linking back to Runs; it is a link, and it takes the sheet shade on hover. The rail itself is not drawn there — the marker alone is enough to carry the continuity.

### Ref Pill

The one round object: a fully-pilled hairline-bordered chip in caption mono holding a PR number (`#1318`), muted ink on sheet, 6px of horizontal padding and a 20px cap height. It is a link; hovering deepens its border rather than adding an underline.

### Motion

Motion in this product reports server state and does nothing else. There is one easing token (`cubic-bezier(0.16, 1, 0.3, 1)`) and one control duration (150ms, for border and colour transitions on fields, buttons and tabs).

- **The in-progress ring** rotates continuously at 1.4s linear — the only perpetual motion tied to a live run, and it means exactly one thing: a run is executing right now.
- **A new run arriving** does two things at once: the row fades in from 4px above over 260ms, and a 3px indigo stroke draws down the rail from HEAD to the new node over 420ms via a clip-path wipe, then fades out over the following 600ms. The rail literally extends to reach the run that just arrived.
- **Skeleton bars** pulse at 1.4s while the answer is still in flight, and stop the moment it lands.
- **Time** ticks from one shared clock — every second while a run is open, every thirty otherwise — so all the relative times on a page change together. Before hydration that clock is null and every time renders as an absolute UTC stamp, so the server's paint and the client's first paint agree exactly.
- **Reduced motion:** the rotating ring slows to 6s rather than stopping (the signal is load-bearing, so it is preserved at a rate that does not disturb); row arrival, rail draw and the skeleton pulse are removed entirely.

### Named Rules

**The Motion-Reports-State Rule.** Every animation in this system is bound to a fact about the server: a ring turns because a run is executing; the rail draws because a run arrived; a bar pulses because an answer is outstanding. There are no entrance animations, no scroll effects, no hover lifts. If a motion cannot name the server state it is reporting, it does not ship.

**The One-Clock Rule.** No component reads the wall clock during render. Relative times come from the shared ticking clock, which is null on the server and through hydration; a component that has no clock yet prints the absolute stamp instead of guessing.

## Do's and Don'ts

### Do:
- **Do** put every new view in the one 72ch column, on the 28px glyph track, with prose capped at 48–60ch.
- **Do** give every state a glyph *and* a word. The glyph is built from the system's circle primitive at 1.5 stroke weight; the word is lowercase.
- **Do** keep indigo on the rail and the in-flight run. If a new element wants the accent, first make it part of the rail's story.
- **Do** use a dashed border for anything severed, absent, stalled, invalid or destructive — it is this system's substitute for red.
- **Do** say what happened in a sentence a person can act on, and put the server's raw string behind a `raw error` disclosure in a command block.
- **Do** set machine text in mono (refs, logins, times, durations, model ids, token counts, setting keys, secret names, commands) and human text in sans.
- **Do** separate sections with vertical space (40px between groups, 48px between major sections) and at most a hairline rule.
- **Do** paint the sheet colour behind anything sitting on the rail and raise it to `z-10`, so the line passes behind the glyph; put anything that must cross those knockouts above them.
- **Do** define both schemes in a single `light-dark()` token when adding a colour. Every colour in the system carries both, and neither is a second-class rendering.
- **Do** show a command the reader can select and run when the fix is a terminal command, in a sheet-shade block that wraps rather than scrolls, with a copy button when the command is the point of the section.
- **Do** give a control its own width at its use site; the field class sets none, and the width should say how big the value is.
- **Do** draw the shape of the content while it loads — the rail with empty nodes, the form with bare rows — and let it pulse in the sheet's second tone.
- **Do** grow a small control's hit area to 24px with padding and cancel it with an equal negative margin.
- **Do** bind a setting's key to its control as a real `<label>`, and its help sentence as the control's description.
- **Do** link out to GitHub with a small arrow glyph rather than re-rendering GitHub's content.

### Don't:
- **Don't** introduce a second hue, or any red / green / amber. Status colour does not exist in this system.
- **Don't** put anything in a card, panel, tile or bordered container. Gaps and hairlines divide; boxes never do.
- **Don't** add an outer shadow, blur, scrim or elevated surface. The only `box-shadow` in the system is the inset 1px rule under the active tab.
- **Don't** set type above 1.25rem, or uppercase and letter-space a label for emphasis.
- **Don't** add a sidebar, a tile grid, a stat tile, or a chart. The rail is the navigation and the summary.
- **Don't** round a corner past 4px. The pill radius belongs to the ref chip alone, because it is quoting GitHub's own chip.
- **Don't** import an icon library, icon font or emoji as UI. Icons are authored SVG on the 16×16 and 12×12 grids at 1.5 stroke; GitHub's logo is the one inlined brand mark, and it is not a licence for a second.
- **Don't** ship a spinner. Pending is the shape of the content that is coming.
- **Don't** animate anything that is not reporting server state, and don't remove the rotating ring under reduced motion — slow it, because it carries meaning.
- **Don't** print a raw stack trace, JSON blob or HTTP body as the first thing a reader sees.
- **Don't** show a save bar on a clean form, or any chrome that has nothing to report.
- **Don't** build an in-page modal or popover for confirmation. Destructive intent is confirmed inline, in the row, with a quiet Keep beside a dashed-on-hover Remove.
- **Don't** call `Date.now()` during render. One shared clock ticks the page.
- **Don't** load a webfont. Both faces are system stacks so the first paint is the final paint.
