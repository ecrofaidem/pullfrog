---
name: frogbot
description: A git graph as a control surface — runs are commits on a rail, and the rail's continuity is the health of the system.
colors:
  sheet: "light-dark(#f4f5f7, #14161a)"
  sheet-2: "light-dark(#eceef2, #1b1e24)"
  ink: "light-dark(#15181d, #e6e8ec)"
  ink-2: "light-dark(#5f6672, #9aa1ab)"
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
  main: "32px"
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
  ref-pill:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-2}"
    typography: "{typography.mono}"
    rounded: "{rounded.pill}"
    padding: "0 6px"
    height: "20px"
  code-block:
    backgroundColor: "{colors.sheet-2}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  nav-tab:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
  nav-tab-active:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
---

# Design System: frogbot

## Overview

**Creative North Star: "The Git Graph Rail"**

frogbot renders the state of a review bot the way git renders history: a vertical hairline down the left edge, a node on it for every run, and a HEAD marker at the top that says in one sentence whether anything is flowing. The rail is not decoration around the data — it *is* the reading order. A visitor lands, reads HEAD, and either sees an unbroken line (reviews are running) or a line that has gone dashed and grey below a struck-through HEAD (the credential is dead, and the one command that fixes it is right there). Only then do they scan down for their own PR. Every screen in the product is a variation on that one gesture.

The world is achromatic by construction. Text, borders, glyphs, buttons and dividers are all ink on a cool near-white sheet (graphite in dark scheme); a single indigo is the only hue in the system, and it is worn exclusively by the rail, the run that is in flight, and the browser affordances that belong to the rail's job (focus ring, selection, caret). Nothing turns red when it fails and nothing turns green when it succeeds — a failed run is a ring with a cross through it and the word "failed", a done run is a filled dot and the word "done". This is an accessibility commitment (status by shape and text, never colour alone) that the build kept without a single exception, and it is also what makes the one indigo legible: when the only colour on the page is the rail, the eye goes to the rail.

Density is high and the chrome is nearly absent. One 72ch column, no sidebar, no cards, no stat tiles, no panels. Sections are separated by vertical gap and, at most, a hairline rule; nothing in this product is ever put in a box. A system sans carries prose and a system mono carries everything the machine owns — repo names, refs, logins, elapsed times, token counts, setting keys, shell commands — so a glance can tell language from data without reading either. It is a tool for people who visit for forty seconds on a phone, and the layout is the same structure at 390px as at 1440px: the column narrows, the rail stays.

**Key Characteristics:**
- One 72ch column; the rail runs down its left edge on every view
- Achromatic ink plus exactly one indigo, confined to the rail and the in-flight run
- State is a glyph plus a word, never a hue
- Flat: no shadow exists anywhere in the system
- Gaps and hairlines divide; boxes never do
- System sans for prose, system mono for machine text
- Motion only ever reports server state

## Colors

A cool achromatic sheet with a five-step ink ramp, plus one indigo that the rest of the palette exists to make loud.

### Primary
- **Rail Indigo** (light `#5b5bd6` / dark `#8b8bff`): the only hue in the product. It draws the rail hairline, the rotating in-progress ring and its "in progress" label, the solid core of a healthy HEAD, the bezier lanes that link an incremental review back to the review it extends, the focused field's border, and the browser surfaces the rail owns — `:focus-visible` outline, `::selection`, `accent-color`, `caret-color`. It appears nowhere else and never as a fill behind text.

### Neutral
- **Sheet** (light `#f4f5f7` / dark `#14161a`): the page ground and the fill of every input. Also painted behind each glyph cell so the rail passes *behind* the nodes rather than through them.
- **Sheet Shade** (light `#eceef2` / dark `#1b1e24`): the only tonal step. Fills command blocks and disabled controls — the two things that are present but not typed into.
- **Ink** (light `#15181d` / dark `#e6e8ec`): primary text, run titles, error text, state glyphs, the active tab's underline, and the primary button's fill.
- **Ink Muted** (light `#5f6672` / dark `#9aa1ab`): secondary text — labels, state words, metadata, inactive tabs, help sentences, the ref pill.
- **Ink Faint** (light `#666d79` / dark `#8b929c`): tertiary text — timestamps, durations, model ids, token counts, disabled state — and the hover border of an unfocused input.
- **Hairline** (light `#d9dce2` / dark `#2a2e35`): every border and divider in the product, and the scrollbar thumb.

### Named Rules

**The Rail-Only Hue Rule.** Indigo is worn by the rail, by the run currently in flight, and by the browser affordances the rail owns. Nothing else in the product is ever coloured. If a new element wants the accent, it must first be part of the rail's story.

**The Never-By-Colour Rule.** No state in this system is signalled by hue. Failure is a struck ring plus the word "failed" in full-strength ink; a destructive button announces itself by its border going dashed on hover, not by turning red. There is no red, green or amber token, and adding one breaks the world.

**The Two-Surface Rule.** There are exactly two backgrounds: the sheet, and one shade of it for command blocks and disabled controls. A third surface tone means someone is building a card.

## Typography

**Body Font:** system-ui (with -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif)
**Label/Mono Font:** ui-monospace (with SF Mono, Menlo, Consolas, Liberation Mono, monospace)

**Character:** Two system stacks and nothing else — no webfont is loaded, so the first paint is the final paint. The pairing does the product's core job: sans is what a person wrote, mono is what the machine owns. Tabular figures are on globally, so times and token counts hold their columns as rows update live.

### Hierarchy

There is no display tier. The ramp tops out at 1.25rem and the sizes sit close together; hierarchy here comes from weight, ink step and position on the rail, not from scale.

- **Headline** (600, 1.25rem/1.75rem, -0.01em): the product name on sign-in. One per document, and most views have none.
- **Title** (600, 1.0625rem/1.5rem, -0.01em): section headings — "Review policy", "Model", "Codex subscription". The only other bold text in the product.
- **Body** (400, 0.9375rem/1.5rem): run titles, HEAD's sentence, prose. Capped at 48–60ch inside the 72ch column.
- **Label** (400, 0.8125rem/1.25rem): the workhorse — state words, run metadata, help text under every setting, button text, nav tabs.
- **Caption** (400, 0.75rem/1rem): ref pills and command blocks only.
- **Mono** (0.9em of its context, tabular): a face switch applied at any size, not a size of its own.

### Named Rules

**The Machine-Text-Is-Mono Rule.** If GitHub or the server owns the string, it is set in mono: `owner/repo`, `#1318`, a login, a relative time, an elapsed duration, a model id, a token count, a setting key (`review.authors`), a shell command. If a person wrote it — a PR title, a help sentence, a heading — it is sans. Mixed baselines in one row are expected and correct.

**The No-Display Rule.** Nothing is set above 1.25rem. This product has no hero, no marketing voice and no title card; a page that needs bigger type is a page that has stopped being a control surface.

**The Lowercase-Machine Rule.** State words and control labels are lowercase (`in progress`, `done`, `failed`, `sign out`, `remove`, `allowlist`); headings and sentences are sentence case. Nothing is uppercased or letter-spaced for effect.

## Layout

One centred column, `max-width: 72ch`, with a 20px page gutter and 24px of top padding (32px from the `sm` breakpoint, 640px). The column is the entire layout: there is no sidebar, no second column, no grid of tiles. Below the column is 96px of dead space so the last run is never flush against the viewport edge.

Inside the column, everything is the same two-track grid: **a 28px glyph column, an 8px gap, then content** (`grid-cols-[28px_1fr] gap-x-2`). The rail hairline sits at the centre of that first track (x = 14px) and runs the full height of the list, inset 12px top and bottom. Rail rows, the HEAD block, credential secrets and the empty state all share this grid, which is why the rail reads as continuous across content of wildly different heights. Rows are 12px of vertical padding; the glyph cell is 24px tall so the node aligns to the first line of its row.

Sections are separated by vertical distance, not containment: 40px between settings groups, 48px between major credential sections, 32px between the header and main content. Within a settings group, rows are divided by hairlines top, bottom and between (`divide-y` inside a `border-y`) — a rhythm of rules, never a bordered box.

**Responsive behavior.** There is one breakpoint (`sm`, 640px) and it changes three things: top padding grows, the settings row goes from stacked to a `11rem` key column beside its control, and the settings save bar stops bleeding to the viewport edge. Everything else reflows on its own — header, run metadata and control rows are all `flex-wrap` with baseline alignment, so a phone gets the same structure at a taller rhythm. The mobile view is not a separate layout; it is the same column, narrower.

**Measure.** Prose is capped tighter than the column: 60ch for settings forms, credential content, health detail and run errors; 56ch for the empty state; 48ch for introductory paragraphs.

### Named Rules

**The One-Column Rule.** Every view is one 72ch column. Anything that wants a sidebar, a split pane or a tile grid is refused; if it needs to sit beside something, it goes further down the rail.

**The Gap-Not-Box Rule.** Sections are separated by vertical space and at most a hairline rule. No card, no panel, no bordered container, no elevated surface. The only rectangles with a fill in this product are command blocks and form controls.

**The 28px Gutter Rule.** Every list-shaped thing on every view uses the 28px glyph track, whether or not the rail is drawn behind it. That shared gutter is what makes Runs, Credentials and the health line feel like one surface.

## Elevation & Depth

There is no elevation. The system contains zero `box-shadow` declarations, no blur, no scrim, no layered surfaces, and no modal or popover that would need one. Depth is conveyed three ways, all of them flat:

1. **Hairlines** separate; a 1px border in the hairline token is the only edge anything gets.
2. **One tonal step** distinguishes an inert surface (command block, disabled control) from the sheet.
3. **Occlusion** does the one job that genuinely needs a z-axis: each glyph cell paints the sheet colour at `z-10`, so the rail hairline passes *behind* the node instead of striking through it. That is the whole depth model — one opaque knockout, no shadow implied.

### Named Rules

**The Flat Sheet Rule.** Nothing in this product casts a shadow. A component that needs to float is a component that does not belong on the rail.

**The Rail Passes Behind Rule.** Any element sitting on the rail must paint the sheet colour behind itself and raise its stacking context. The line must never appear to cross a glyph.

## Shapes

Corners are almost square: 4px on inputs, buttons and command blocks; 2px on the focus outline. The single exception is the **ref pill** (999px), which is fully round because it is quoting GitHub's own ref chip — roundness is reserved for that one borrowed object, and nothing else in the system is allowed it.

Borders are always 1px. The system uses **border style as a semantic**, not just border colour: solid is normal, and dashed means *broken or dangerous*. A cut rail is a dashed 4-on-4-off gradient in faint ink; a rejected HEAD is a dashed ring struck through; an invalid field goes ink-coloured and dashed; a destructive button's border goes dashed on hover. Because the palette refuses red, the dash carries that meaning instead.

The glyph vocabulary is authored SVG on a 16×16 grid at a single 1.5 stroke weight, built from one primitive — a circle — modified: filled (done), dashed and rotating (in progress), crossed (failed), slashed (cancelled), hollow (queued/dispatched). HEAD is the same circle one step larger (r 5.5 vs 4.5) so it reads as the rail's origin. Any new glyph must be that circle, modified.

### Named Rules

**The Dashed-Means-Broken Rule.** A dashed border is never decorative. It means severed, rejected, invalid or destructive, and it is how this achromatic system says what other systems say in red.

**The One-Stroke Rule.** Every icon and glyph is authored SVG on a 16×16 (or 12×12) grid at 1.5 stroke weight, drawn from the system's own circle primitive. No icon library, no icon font, no imported set.

## Components

### Buttons

Small, quiet, rectangular; a button here is a labelled edge, not an object.

- **Shape:** near-square corners (4px), 1px border always present, 12px × 6px padding, label type (0.8125rem, 500 weight), inline-flex with a 6px gap for an optional 12px glyph.
- **Primary:** full ink fill with sheet-coloured text and an ink border — the darkest thing on the page, used once per view (Save changes, Continue with GitHub). Hover drops opacity to 0.88; disabled swaps to the sheet shade with faint ink and no border colour.
- **Quiet:** transparent fill, hairline border, ink text. Hover deepens the border to faint ink. This is the default for anything that is not the one committing action (Discard, Keep).
- **Danger:** identical to quiet at rest — no red, no fill. On hover the border goes to full ink *and turns dashed*. Destructive intent is confirmed inline ("remove SECRET_NAME?") rather than in a dialog; there are no modals in this system.
- **Text buttons:** for tertiary actions (sign out, remove) the button drops its border entirely and becomes underlined muted-ink text that darkens to full ink on hover.

### Inputs / Fields

One class covers text inputs, textareas and selects, so a form reads as a single material.

- **Style:** sheet fill, 1px hairline border, 4px corners, body type, 10px × 6px padding. Width is explicit and content-sized (`w-28` for a timeout, `w-40` for a handle, `w-64` for a model id) rather than full-bleed — the field's width is a hint about the value's size.
- **Hover:** border deepens to faint ink over 150ms.
- **Focus:** border goes rail indigo and the native outline is suppressed — the field joins the rail's colour while it is being edited. Everything else in the product keeps the global 2px indigo `:focus-visible` outline at 2px offset.
- **Disabled:** sheet-shade fill with faint ink text.
- **Invalid:** border goes full ink and dashed (`aria-invalid="true"`). Never red.
- **Mono variant:** any field holding machine text (handle, model id, timeout, allowlist, scripts) carries the mono class.

### Navigation

- **Style:** three inline text tabs (Runs · Settings · Credentials) in the header at label size, 16px apart, sitting on the baseline beside the repo's mono full name.
- **States:** inactive is muted ink over a transparent bottom border; active is full ink over a 1px ink bottom border with 2px of padding beneath. The transparent border is always present so nothing shifts on activation.
- **Mobile:** the header simply wraps — repo name on one line, tabs and identity on the next. No hamburger, no drawer, no bottom bar.
- **Identity:** the signed-in login in mono, faint, pushed to the far end, with an underlined text "sign out" beside it.

### Settings Rows

- **Structure:** a mono key on the left (`review.authors`, `comments.progress`) in an 11rem column, the control on the right, and one sentence of help in faint ink directly beneath the control. Below 640px the key stacks above its control.
- **Grouping:** rows are hairline-divided inside a hairline-bounded stack, under a title and a one-line hint. No fieldset, no card.
- **Commit:** a sticky bar at the bottom of the viewport with a hairline top border and a sheet fill, carrying the primary Save and a quiet Discard. When clean it shows provenance instead ("last changed by X, 3m ago"), and after a save it shows a check glyph and "saved just now". The dirty state is what makes the buttons appear at all.

### The Rail (signature component)

The product's one structural invention, and the thing every other view borrows from.

- **The line:** a 1px hairline in rail indigo at x = 14px, running from just under HEAD to just past the last node. When HEAD is cut it becomes a 4-on-4-off dashed gradient in faint ink — the rail visibly breaks, and that break is the fastest signal on the page.
- **HEAD:** a larger ring at the top carrying one sentence of derived health. Healthy is a rail-indigo ring with a solid core plus a muted sentence ("chain refreshed 3m ago · last run 13m ago"); a warning is the same ring hollow, in ink, with full-weight text; a cut is a dashed ink ring struck through, followed by a detail paragraph and the exact reseed command in a selectable command block. Health escalates the *weight and detail* of the same sentence — it never changes its colour or position.
- **Nodes:** one glyph per run, in ink, on a sheet-painted cell so the rail passes behind. Row content is a ref pill, the PR title (shown once per PR group; later runs of the same PR show their kind instead), the state word, then a metadata line of triggerer, relative time, elapsed, model, token counts and a link out to the Actions log.
- **Lanes:** an incremental review draws a rounded bezier from its node out to x = 26px, down, and back into the node of the nearest older run on the same PR — a 1px rail-indigo curve at 0.7 opacity, measured from the live glyph positions so it survives reflow, font loading and resize.
- **On other views:** Settings and Credentials carry the same HEAD sentence as a one-line banner in the same 28px gutter, linking back to Runs. The rail itself is not drawn there — the marker alone is enough to carry the continuity.

### Ref Pill

The one round object: a fully-pilled hairline-bordered chip in caption mono holding a PR number (`#1318`), muted ink on sheet, 6px of horizontal padding and a 20px cap height. It is a link; hovering deepens its border rather than adding an underline.

### Motion

Motion in this product reports server state and does nothing else. There is one easing token (`cubic-bezier(0.16, 1, 0.3, 1)`) and one control duration (150ms, for border and colour transitions on fields, buttons and tabs).

- **The in-progress ring** rotates continuously at 1.4s linear — the only perpetual motion in the system, and it means exactly one thing: a run is in flight right now.
- **A new run arriving** does two things at once: the row fades in from 4px above over 260ms, and a 3px indigo stroke draws down the rail from HEAD to the new node over 420ms via a clip-path wipe, then fades out over the following 600ms. The rail literally extends to reach the run that just arrived.
- **Reduced motion:** the rotating ring slows to 6s rather than stopping (the signal is load-bearing, so it is preserved at a rate that does not disturb); the row and rail-draw animations are removed entirely.

### Named Rules

**The Motion-Reports-State Rule.** Every animation in this system is bound to a fact about the server: a ring turns because a run is executing; the rail draws because a run arrived. There are no entrance animations, no scroll effects, no hover lifts. If a motion cannot name the server state it is reporting, it does not ship.

## Do's and Don'ts

### Do:
- **Do** put every new view in the one 72ch column, on the 28px glyph track, with prose capped at 48–60ch.
- **Do** give every state a glyph *and* a word. The glyph is built from the system's circle primitive at 1.5 stroke weight; the word is lowercase.
- **Do** keep indigo on the rail and the in-flight run. If a new element wants the accent, first make it part of the rail's story.
- **Do** use a dashed border for anything severed, rejected, invalid or destructive — it is this system's substitute for red.
- **Do** set machine text in mono (refs, logins, times, durations, model ids, token counts, setting keys, commands) and human text in sans.
- **Do** separate sections with vertical space (40px between groups, 48px between major sections) and at most a hairline rule.
- **Do** paint the sheet colour behind anything sitting on the rail and raise it to `z-10`, so the line passes behind the glyph.
- **Do** define both schemes in a single `light-dark()` token when adding a colour. Every colour in the system carries both, and neither is a second-class rendering.
- **Do** show a command the reader can select and run when the fix is a terminal command, in a sheet-shade block at caption size.
- **Do** link out to GitHub with a small arrow glyph rather than re-rendering GitHub's content.

### Don't:
- **Don't** introduce a second hue, or any red / green / amber. Status colour does not exist in this system.
- **Don't** put anything in a card, panel, tile or bordered container. Gaps and hairlines divide; boxes never do.
- **Don't** add a shadow, blur, scrim or elevated surface. The system has zero `box-shadow` declarations and should keep it that way.
- **Don't** set type above 1.25rem, or uppercase and letter-space a label for emphasis.
- **Don't** add a sidebar, a tile grid, a stat tile, or a chart. The rail is the navigation and the summary.
- **Don't** round a corner past 4px. The pill radius belongs to the ref chip alone, because it is quoting GitHub's own chip.
- **Don't** import an icon library, icon font or emoji as UI. Icons are authored SVG on the 16×16 grid at 1.5 stroke, drawn from the circle primitive.
- **Don't** animate anything that is not reporting server state, and don't remove the rotating ring under reduced motion — slow it, because it carries meaning.
- **Don't** build a modal or popover for confirmation. Destructive intent is confirmed inline, in the row, with a quiet Keep beside a dashed-on-hover Remove.
- **Don't** load a webfont. Both faces are system stacks so the first paint is the final paint.
