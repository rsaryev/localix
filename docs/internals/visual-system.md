# Visual system

This page is the contract for how a Localix surface is painted: which token a fill comes from, which
step a control sits on, and which of those rules a machine checks. Read it before adding a pane, a
control, or a mini app surface, and when a review asks why a colour was rejected.

## Terminology

| Term              | Meaning                                                                          | Boundary                                                                        |
| ----------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Ground            | The window's own base colour — `--background` and `--sidebar`.                   | Under the macOS glass theme it is translucent, so painting it twice compounds.  |
| Veil              | A fill mixed from `--foreground` into transparency, e.g. `bg-foreground/[0.04]`. | Takes the colour of whatever it covers; correct in every theme by construction. |
| Lift              | An element-sized surface a step above its pane — `--card`, `--popover`.          | For cards, rows and floating panels; never for something that fills a pane.     |
| Recess            | An element-sized surface a step below its pane — `--surface-sunken`.             | A black veil under glass; a pane-sized recess must be a border instead.         |
| Outermost painter | The one element in a nesting chain that paints the ground.                       | Six exist; every other pane inherits. See `scripts/pane-ground-guard.test.ts`.  |
| Control ladder    | The height scale `--chrome-control-xs…touch` (20/24/28/32/36/40px).              | A control's height comes from a rung, never from a pixel literal.               |

## What you can do

| Task                             | Do this                                                                                                   | Boundary                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Add a pane (feature or mini app) | Paint no ground at all — inherit the pane you are mounted into.                                           | Only a standalone full-window route may paint one; add it to the guard's list.                         |
| Size a pane's body               | Fill the pane: gutters (`px-4 @2xl:px-6`), no column. Long-form prose uses `--reading-measure`.           | `mx-auto` with a literal `max-w-*` spends a wide pane on two empty gutters.                            |
| Fill a field or a trigger        | `FIELD_SURFACE` from the SDK's `ui/classes` — radius, hairline and `bg-field-fill`.                       | Not `--input`, which is an opaque grey in the plain dark theme.                                        |
| Mark a control invalid           | `CONTROL_INVALID` from the SDK's `ui/classes`.                                                            | One recipe for every control; a transcribed copy had already lost its dark ring.                       |
| Fill a chip or a pill            | `bg-field-fill` at rest, or `.lx-glass` for a chip that floats over content.                              | Not a ground token: those mix darker than the pane and read as black chips.                            |
| Put a button on a tinted band    | `<Button variant="field">` — a bordered button resting on the `--field-fill` veil.                        | `field` adds a hairline around the shared field-fill veil; `secondary` remains borderless.             |
| Show hover / selected            | `bg-surface-hover` (7%) and `bg-surface-active` (11%).                                                    | Both are veils; an opaque grey stops working the moment the ground moves.                              |
| Float a panel over content       | `POPOVER_SURFACE` (panel) or `FLOATING_SURFACE` (toolbar, label) from `kit/src/overlays/popover-surface`. | Both are `POPOVER_MATERIAL` plus a shape; never transcribe the material itself.                        |
| Collapse a sidebar to icons      | `SidebarNav mode="compact"` with `onToggle`: the column folded to a rail, in the layout.                  | The host gives it the narrower width; folding resizes the page beside it, nothing floats. No tooltips. |
| Animate an overlay in and out    | `OVERLAY_ENTER_EXIT` / `SCRIM_ENTER_EXIT` / `TOOLTIP_ENTER_EXIT` from `kit/src/overlays/overlay-motion`.  | A primitive that writes its own animation fails `overlay-motion.test.ts`.                              |
| Time a transition                | A motion token: `duration-(--dur-*)`, `ease-(--ease-*)`.                                                  | A literal `duration-200` or `ease-out` is a second opinion the tokens cannot retune.                   |
| Open a disclosure                | `COLLAPSIBLE_MOTION` from `@localixai/kit/collapsible-motion`.                                            | The chevron and the body must settle on the same beat.                                                 |
| Pin a sticky header              | `.lx-occluder` — the pane's own hue at a density that occludes, frosted.                                  | This deliberately escapes the paint-once rule: it must hide what scrolls under.                        |
| Give keyboard focus an indicator | The `focus-ring` utility, or a shared primitive that already carries one.                                 | Never a second `focus-visible:ring-*`; focus is what a keyboard user steers by.                        |
| Size a control                   | A rung name — `xs` 20, `sm` 24, `md` 28, `lg` 32, `xl` 36 — the same on every primitive.                  | A name means one height everywhere: `sm` is 24px on a button, a field and a segmented control.         |
| Choose a radius                  | `rounded-xs` for glyph-sized marks, `rounded-sm` ≤20px, `rounded-md` 24–36px, `rounded-full` pills.       | Bare `rounded` is Tailwind's 0.25rem and is off the `--radius` scale entirely.                         |
| Name a token in a class          | Only a name `tailwind-theme.css` declares — `text-text-soft`, never `text-text-muted`.                    | Tailwind emits nothing for an absent name; `scripts/ui-token-existence-guard.test.ts` fails.           |
| Colour something by identity     | A token: `--status-*`, `--conn-*`, `--chart-N`.                                                           | A raw Tailwind palette class cannot follow a theme and is rejected by the token-drift rules.           |

## How it works

### Workbench geometry and typography

Workbench geometry follows the conventions of a dense editor shell: compact status items, stable
panel rows, and text sized independently of window chrome. Localix keeps its own materials and its
20/24/28/32/36/40px control ladder.

The root font defaults to 14px. The small text tiers are calibrated against that root rather than
Tailwind's usual 16px: `3xs` is 10px for keycaps and counts, `2xs` is 11px for metadata, `xs` is
12px for controls, and `sm` is 13px for navigation. They remain rem-based so the font-size
preference scales them. Body text uses native letter spacing and the font's default letterforms.

The native Monaco definition/reference peek uses app typography for its title and result tree, soft
docked seams and the app's selection and navigation highlight colors. It paints one foreground veil
over the editor ground; the preview and result tree stay transparent to avoid an opaque black slab
under glass. Long title paths truncate before the result count. Monaco retains ownership of the
measured header height and split preview layout.

Panel headers, default toolbars, compact breadcrumbs, and primary editor tabs use the same 12px
`--workbench-gutter`. This physical inset stays aligned when typography changes. Panel and editor
headers remain 36px; the status row is 24px. Workbench list rows use 28px for dense rows, 32px for
compact rows, and a 40px minimum for rows with descriptions. These are minimums so larger text can
grow a content row. Session rows retain their own 32px measure.

Local-service startup and failure use a compact indicator at the right of the existing titlebar
(mobile: the header). Once ready, it releases its width so no empty slot remains after the
notification button; the editor grid stays in place. Startup shows the activity orb with a status
tooltip; failures show an alert action with Retry or Restart Localix. The same message is announced
through a polite live region. The implementation is
`apps/ui/src/pages/chat/ui/WorkspaceConnectionStatus.tsx`; captures show
[startup](../assets/screenshots/workspace/service-starting--2026-09-30.png) and
[runtime failure](../assets/screenshots/workspace/service-error--2026-09-30.png).

Editable files keep their actions in a slim row above the code, alongside document-symbol
breadcrumbs. The file breadcrumb exposes document symbols, scope peers, and children in searchable
menus instead of a separate Outline panel. The **File actions** overflow menu contains Save, Copy
file contents, and the available preview modes. Review comments and the unsaved indicator stay
visible in the row. Editor controls reserve their own space so they never cover text or intercept
code clicks.

Read-only files, image/SVG previews, bridged mini app views, and Git diffs use the same slim toolbar
measure. Their controls remain outside the scrolling content. Diff layout, hunk navigation, and host
actions share one toolbar; multi-file headers stay aligned while each file's long code lines scroll
horizontally. Git changes, branches, and stash rows use the shared dense list-row measure, and their
secondary actions use the same small button ladder.

Monaco and xterm start from the same 13px code measure through
`packages/kit/src/lib/density-ratio.ts`. Both scale with the root preference; an existing terminal
adopts that size when reopened. Modal titles inherit the chosen UI font and use the 14px base tier.
Shortcut hints keep native tracking, and shared keycaps center their text inside a stable box.

The real workspace captures use an isolated database with an empty project:
[before](../assets/screenshots/workspace/workbench-before--2026-09-30.png) and
[after](../assets/screenshots/workspace/workbench-after--2026-09-30.png). Additional captures show
the [light workbench](../assets/screenshots/workspace/workbench-light--2026-09-30.png),
[command palette](../assets/screenshots/workspace/command-palette--2026-09-30.png), and
[board shortcut sheet](../assets/screenshots/workspace/board-shortcuts--2026-09-30.png). The
shortcut sheet uses a shared key column across sections, allows alternative chords to wrap, and
keeps descriptions aligned even when they span multiple lines.

### Quiet actions

Ordinary `Button` actions rest as text, with a foreground veil on hover and press. The existing
`outline` API is a compatibility name for the same borderless secondary action; it no longer draws a
resting enclosure. Use an `IconButton` with an accessible name and tooltip for familiar compact
actions such as creating a project. Keep text when the action needs explanation. `mono` remains
available for a strong primary action, and `field` encloses actions on tinted state bands. Focus,
disabled and busy states use the existing kit recipes.

### Settings hierarchy

Settings groups follow the same workbench tokens: one faint outline and a 2% foreground veil per
section, `p-4` inner padding (1rem), and `space-y-8` between page blocks (2rem). Section titles use
the 14px base tier with semibold weight; setting labels use the 13px tier with medium weight, and
explanations use 12px soft text. The page title stays at the compact 1.25rem tier and is the kit's
`SectionHeading`, the same block the Store opens its pages with. A nested row list or form inherits
its section's surface rather than painting a second card.

Navigation groups personal preferences, workspace configuration and application maintenance. At
56rem of settings-pane width it becomes a 12rem navigation column; below that it uses the kit's
section selector. Headers and label/control rows stack on their content container's width, never the
viewport. Search remains present in both layouts. The full inventory and saving rules are in
[Settings](../features/settings.md).

Settings uses `SettingsWorkspace` for the pane layout and `SettingsNavigation` for the grouped rail
and narrow section picker; the picker takes the `xl` rung of the search beside it (`SidebarNav`'s
`selectSize`), so the two read as one strip. Sections are built from `SettingsSection`; lists inside
it inherit the section surface. A `SettingsRow` with the `responsive` layout stacks its label above
the control until the container is 36rem wide.

Form actions use the same 36px `xl` control tier as their inputs. A section containing one control
omits the second heading/body tier: `SettingsSection` without children puts its value in the heading
row, uses `p-3` padding and a medium 13px label, and stacks below 36rem. Keymap, recent views and
spend alerts share this compact form.

### Which primitive for which job

Find the job, take the door, and check the last column before hand-rolling the neighbour. The table
is written from the kit catalog (`packages/kit/src/catalog/`), which stays the full list; the Store
and Settings are drawn with these.

| Job                                                 | Door (`@localixai/kit/…`)                           | Not                                                    |
| --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| Title, description and actions of a page or section | `section-heading` (`level` page or section)         | A hand-made `h2` plus a `text-sm` paragraph            |
| The pane's own title row                            | `panel-header`                                      | A heading with a search beside it is `section-heading` |
| A small uppercase label over a group                | `section-label` (`as="h3"` when it heads the group) | A heading of a page or section (`section-heading`)     |
| A command with a label                              | `button`                                            | A native `<button>`                                    |
| Text that is a command inside prose                 | `text-action`                                       | A `Button` styled as a link; a row's open target       |
| A labelled control with help and error              | `field` (stacked; `inline` puts a switch first)     | A hand-made `<label>` and a `<span>`                   |
| A list separated by hairlines                       | `divided-list` (`DIVIDED_LIST`)                     | A bordered card with `divide-y`                        |
| A navigable row: open target, meta, actions         | `workbench-list-row` (+ Trigger, Meta, Actions)     | A `<li>` of hand-placed flex children                  |
| A pane-wide search and filter row                   | `workbench-filter-bar` with `search-input`          | A `flex-wrap` div of a field and chips                 |
| A chip that filters, pressed or not                 | `toggle-pill`                                       | `ChipButton` (it acts, it holds no state)              |
| A pill for a count or label                         | `chip` (`Chip`)                                     | A `rounded-full` span                                  |
| A pill that acts: a tag, a category to browse       | `chip` (`ChipButton`)                               | `composer-chip` (the glass pill of the composer)       |
| A notice above content, with actions                | `workbench-notice-bar` (set `role` yourself)        | A bordered `div` with an icon and two buttons          |
| Nothing here, or a failure with a retry             | `empty-hint`, `state-notice`                        | A centred `<p>`                                        |
| A storefront row of tiles with See all              | `shelf-row` with `tile-card`                        | A full list of item cards (`card-grid`)                |
| A browsable card that opens a page                  | `item-card` inside `card-grid`                      | A navigable sidebar row                                |
| The install control of a package                    | `get-button`                                        | A generic `button`                                     |
| Tabs inside a pane                                  | `tabs`                                              | A `role="tablist"` row of buttons                      |
| A section sidebar                                   | `sidebar-nav`                                       | Tabs, or the application rail                          |

Things only the Store draws, left on purpose: the category tile of Discover (an icon, a name and a
count in one button, wider than a chip), the collection card, and the facts card of a package page
(`PackageFacts`). No kit surface does their job, so they use tokens and radii but not a primitive.

### Every fill answers one question: what is under me?

The macOS window is backed by an `NSVisualEffectView`, so the ground tokens carry alpha. That single
fact drives the whole system. `packages/kit/styles/window-material.css` clears the root backdrop
only for `data-desktop='true'` with `data-os='mac'`; browsers and other desktops keep the synthetic
backdrop. Reduced transparency restores an opaque ground on every platform. A fill that names a
colour outright — a ground token, an opaque grey, a palette class — is a bet that the thing
underneath will not move. It moves: between themes, between panes, and between a window with a
material and one without.

A veil makes no such bet. `bg-foreground/[0.04]` is "whatever is under me, four percent denser", so
one value is correct on near-black, on graphite and on white. Fills, hovers, borders and chips are
all veils for this reason, and the ones that are not are listed above with the reason they are not.

### Over content the app does not own, glass has nothing to bet on

A floating panel is translucent and frosted because it frosts over the app's own chrome, whose tone
the system knows. One panel does not: the preview's comment composer floats over a live page
belonging to whoever wrote it. There the same 82% white sat above a beige game board and the label,
the placeholder and the Attach row all washed out — the panel was a smear rather than a card.

So `POPOVER_SURFACE_OVER_FOREIGN` is opaque, built on `--background-solid` — the token this codebase
already keeps for component fills that opt out of glass — and it carries neither marker class the
frost rules select on, so no `backdrop-filter` reaches it. It stays identical in every other
respect, because the panel is the same panel; only the assumption about what is behind it changed.

### The ground is painted once

Two coats of a translucent ground composite: 85% over 70% is 95.5% opaque, which is black. An
unlayered rule in `apps/ui/src/app/index.css` clears any ground nested inside another ground —
whichever token each uses, because matching them token-for-token is exactly where the bug hid. The
rule reaches rendered utility classes; `scripts/pane-ground-guard.test.ts` covers what it cannot, by
refusing a pane-sized element that paints a ground in the first place.

### Motion is a token, and an overlay has one recipe

Every duration and curve comes from the motion tokens in `packages/kit/styles/theme-dark.css`:

| Token               | Value                            | For                                                                |
| ------------------- | -------------------------------- | ------------------------------------------------------------------ |
| `--dur-instant`     | 100ms                            | An overlay answering a click — popover, menu, dialog, tooltip.     |
| `--dur-fast`        | 150ms                            | Hover and press feedback.                                          |
| `--dur-base`        | 200ms                            | Panels, drawers, disclosures.                                      |
| `--dur-moderate`    | 260ms                            | A reveal that travels — an activity label, a wizard step.          |
| `--dur-slow`        | 500ms                            | Progress and the theme sweep.                                      |
| `--ease-soft`       | `cubic-bezier(0.22, 1, 0.36, 1)` | The default settle; Tailwind's `transition-*` default points here. |
| `--ease-emphasized` | `cubic-bezier(0.32, 0.72, 0, 1)` | Larger entrances.                                                  |
| `--ease-standard`   | `cubic-bezier(0.4, 0, 0.6, 1)`   | A loop that returns to where it started — a breathing pulse.       |
| `--ease-exit`       | `cubic-bezier(0.4, 0, 1, 1)`     | Accelerating something out of view.                                |

The reason is the same as for fills: a literal is a bet that nobody will retune the system. Before
the tokens covered every case, seven overlays each wrote `duration-100` in one of two variant
spellings, and the theme sweep restated `--ease-soft` as a string — retiming the tokens left the
most visible motion in the app on the old values. `kit/src/overlays/overlay-motion.ts` now owns
every overlay's entrance and exit, and its test fails when a primitive transcribes one again.
Reduced motion needs nothing per component: the base layer collapses every transition and animation
under `prefers-reduced-motion: reduce`.

### One material, cut to several shapes

`POPOVER_MATERIAL` is the floating glass — fill, frost marker, shadow and rim ring — with no
geometry. `POPOVER_SURFACE` cuts it to a panel (`rounded-xl`), `FLOATING_SURFACE` to a strip at
control radius (a toolbar over content, a tooltip), and the picker drawer takes it bare. They used
to transcribe the material, and each copy dropped a different piece of it: the tooltip lost the rim
ring, the toolbar the text colour. The fields have the same shape of rule in the SDK:
`FIELD_SURFACE` is what makes a field look like a field, and `CONTROL_INVALID` is the one invalid
state.

### A pick is a menu, not a form

Choosing among a few options, such as a mode, an agent, a version or a level, is a kit
`DropdownMenu` (or `ContextMenu`) built from `MenuEntries`, the same family every menu in the app
uses, so spacing, colour and keyboard behaviour cannot drift between pickers. The plan's Approve
menu (`apps/ui/src/entities/chat/ui/plan/ApprovePlanPopover.tsx`) and the composer's mode menu
(`apps/ui/src/entities/chat/ui/prompt-input/PermissionModeControl.tsx`) are the reference.

- An option row is `selected` (a radio: its icon stays in the leading slot, a ✓ sits at the end),
  never `checked`, which is a checkbox for a real multi-select or an on/off toggle. Both are drawn
  the same way, so only the role differs and the choice is by meaning. What an option means is its
  `description`, a line under the label, never a paragraph beside the control.
- A second dimension is a submenu row whose `hint` shows the current pick. Its options are
  `keepOpen`, so choosing returns to the parent level, and an action row (Approve, Apply) closes the
  menu.
- The trigger is the quiet control already in place, an icon or a short label and a chevron. The
  menu opens away from the composer (`side="top"`) when the trigger sits on it.
- Icons and tones come from the one presentation map of the concept (for example
  `permissionModeIcons.ts`), so the same option looks the same in every list.
- Not for picks: segmented controls inside popovers, chip grids, framed `Select` fields in a header,
  or a free-text field whose `@mentions` stand in for a choice. A `Select` is for a value in a form
  that is saved with other fields.

### The next step is suggested, once

A surface with one expected next step marks it with the kit `Button`'s `recommended` flag, a
travelling accent turned down so the person finds the step without anything shouting. Mark one step
per surface, and only a safe one: never a permission grant (Allow or Approve on a confirm card),
never a destructive action, and never while the run is busy. The flag follows the state, so it is
gone once the step is taken.

The plan's Approve menu is the reference: the trigger is recommended while a version waits with no
open comments, and Request changes takes the mark instead when there are some. A menu's action row
can carry the flag too (`recommended` on the `MenuActionEntry`), so Approve marks both its trigger
and its own row in the menu it opens.

### Rules are enforced, not documented

Each rule below is a check, because a convention that is only written down drifts. The count in the
last column is what the corresponding check found on its first run.

| Rule                                                                               | Enforced by                                        | Found |
| ---------------------------------------------------------------------------------- | -------------------------------------------------- | ----- |
| A pane paints no ground                                                            | `scripts/pane-ground-guard.test.ts`                | 38    |
| A control paints no ground                                                         | `localix/no-ground-token-on-control`               | 1     |
| One radius scale                                                                   | `localix/no-off-scale-radius`                      | 97    |
| One focus recipe                                                                   | `localix/no-adhoc-focus-ring`                      | 34    |
| Colour comes from a token                                                          | `localix/no-hardcoded-colors`                      | 30    |
| Keyboard ownership goes through the registry                                       | `localix/no-global-key-listener`                   | 15    |
| Durations, curves, layers, type, border steps, shadows and radii come from a token | `scripts/ui-token-drift-guard.test.ts`             | 630   |
| No palette colour, no alpha foreground text                                        | `scripts/ui-token-drift-guard.test.ts`             | 0     |
| A pane body fills its pane (no centred literal column)                             | `scripts/ui-token-drift-guard.test.ts`             | 10    |
| A class that names a kit colour or radius names one the theme declares             | `scripts/ui-token-existence-guard.test.ts`         | 33    |
| An overlay takes its motion from one recipe                                        | `packages/kit/src/overlays/overlay-motion.test.ts` | 7     |

The token-drift rules have one owner, `apps/api/src/contracts/ui-token-rules.ts`, and two readers:
the guard above, over the app, and the style step of the authoring plugin's check (through the kit's
tools), over a mini app a person builds, where no repository guard can see it. The style step adds
one rule of its own: a native button, input, select or textarea where the kit has a control.

## Configuration

| Where                                          | Owns                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `packages/kit/styles/index.css`                | The ordered import list of the layers below — its order is the cascade.                                 |
| `packages/kit/styles/`                         | One file per layer: tokens, themes, window material, base, materials, motion, utilities, accessibility. |
| `packages/kit/src/overlays/overlay-motion.ts`  | Every overlay's entrance and exit.                                                                      |
| `packages/kit/src/overlays/popover-surface.ts` | The floating material and its shapes; menu geometry.                                                    |
| `packages/oxlint-rules/src/rules/`             | The per-node rules, each with its reasoning in the file header.                                         |
| `scripts/pane-ground-guard.test.ts`            | The whole-tree invariant and the allowlist of outermost painters.                                       |
| `apps/ui/src/shared/ui/`                       | The primitives that define geometry, focus and material for consumers.                                  |
| `packages/mini-app-sdk/src/ui/`                | The same primitives as a mini app sees them.                                                            |

## Limits

On macOS, the native window buttons and breadcrumb toolbar share one row. The shell measures their
button gap and row height and reserves a separate band for native workspace tabs below it. The
toolbar paints its sidebar coat; only the native tab band receives a native coat.

The Event Center excludes this native chrome from its popover collision area. Its header stays below
the tabs, and its scrollable journal uses the remaining window height, including when the native tab
band changes or the window enters fullscreen. Its fill and backdrop blur use the same shared
floating material as context menus.

When a desktop window loses focus, the titlebar dims its contents only. Its sidebar ground keeps the
same opacity as the native header, so the two bars remain aligned over the shared material.

The person's window transparency level (`data-window-transparency` on `<html>`, written by
`apps/ui/src/shared/theme/windowTransparency.ts` and by the `index.html` boot script) scales the two
ground coats through `--coat-scale` and `--coat-lift`; it never restates a density. Tune a theme's
look through its `--*-density` tokens and every level follows. A level changes `--sidebar`, so it
re-sends the native header tint. The OS Reduce transparency preference still wins.

The glass theme is macOS-only: the `@supports` blocks are scoped to `[data-desktop][data-os='mac']`,
and every other platform gets the opaque tokens, which is why a fill can look correct in a browser
and wrong in the app. The guards are static — they read class strings, so a class assembled at
runtime from variables passes unchecked. Neither guard covers CSS files;
`apps/ui/src/shared/ui/code-editor/monacoEditor.css` carries its reasoning in a file-header comment
instead.

Three surfaces still keep a private copy of something the system owns, because moving them would
change behaviour rather than paint:

- The terminal quick-pick (`features/terminal/ui/TerminalQuickpick.tsx`) runs its own listbox and
  arrow-key model instead of the shared `command.tsx`; cmdk's filtering and focus model differ.
- The workspace shell's mobile sidebar (`widgets/workspace-shell/ui/WorkspaceShell.tsx`) draws its
  own drawer and scrim instead of the kit's `overlays/drawer.tsx`; vaul would add drag-to-dismiss.
- `CollapsibleStrip` animates `max-height` rather than the grid-rows reveal the other disclosures
  use, because the same value caps the strip's scrollable list.

## Related guides

- [SDK](sdk.md) — how a mini app reaches these primitives.
- [Architecture](architecture.md) — where the UI layers sit.

## Source of truth

- [`packages/kit/styles/index.css`](../../packages/kit/styles/index.css) — the layer order;
  [`packages/kit/styles/`](../../packages/kit/styles/) — tokens, themes, glass, motion, paint-once.
- [`packages/kit/src/overlays/overlay-motion.ts`](../../packages/kit/src/overlays/overlay-motion.ts)
  — overlay entrance and exit.
- [`scripts/pane-ground-guard.test.ts`](../../scripts/pane-ground-guard.test.ts) — the pane
  invariant.
- [`packages/oxlint-rules/src/index.ts`](../../packages/oxlint-rules/src/index.ts) — the rule
  registry.
- [`packages/kit/src/overlays/popover-surface.ts`](../../packages/kit/src/overlays/popover-surface.ts)
  — the floating material and its shapes.
- [`packages/kit/src/controls/choice-trigger.ts`](../../packages/kit/src/controls/choice-trigger.ts)
  — the field fill and why two earlier ones failed.
