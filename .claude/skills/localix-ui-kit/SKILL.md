---
name: localix-ui-kit
description: >-
  Build or change any Localix UI — a workbench surface in apps/ui, a plugin view in plugins/*/ui, or
  a primitive in packages/kit — so it is made from the kit and stays consistent: which module for
  which job, the size and tone vocabulary, tokens instead of literals, the checks to run, and how to
  add a primitive. Use before writing or reviewing a component, a view, a style or a class string.
  Not for backend-only plugin work.
---

# Localix UI kit

Every Localix surface is drawn with `@localixai/kit` (`packages/kit`). The app and every plugin
import the same modules; a plugin takes them from the running host. Drift is a defect here, and most
of it is caught by checks — work with them, not around them.

## 1. Pick the module by the job

Open the catalog — `packages/kit/src/catalog/` (by category), rendered in `docs/extending/ui-kit.md`
— and find the JOB, not a name. The kit has, among ~100 modules: tabs, tree navigation, list rows,
`TableGrid`, empty and error states, progress, chips, stats, dialogs, menus that render as both
dropdown and context menu, a resize sash, a segmented control
(`@localixai/plugin-sdk/ui/segmented-control`), charts (`@localixai/plugin-sdk/ui/charts`) and the
canvas. Hand-rolling any of these is the most common drift found in this repository.

A choice among a few options (a mode, an agent, a version) is a `DropdownMenu` of `MenuEntries` rows
marked `selected` (icon kept, ✓ at the end), a second dimension is a submenu with the current pick
as its `hint` and `keepOpen` options — not a segmented control or chip grid inside a popover. The
rule and the reference implementation are in `docs/internals/visual-system.md` under "A pick is a
menu, not a form".

Import from the door: `import { Button } from '@localixai/kit/button'`. Never `@/shared/ui/<x>` for
a primitive, never a native `<button>`/`<input>`/`<select>`/`<textarea>`, never Radix, cmdk, vaul or
`@xyflow` directly.

## 2. Use the shared vocabulary

| Axis        | Values                                           | Note                                      |
| ----------- | ------------------------------------------------ | ----------------------------------------- |
| `size`      | `xs` 20, `sm` 24, `md` 28, `lg` 32, `xl` 36 px   | Same height for the same name everywhere. |
| action tone | `default`, `danger`                              | What a click does.                        |
| status tone | `neutral`, `info`, `success`, `warning`, `error` | What state a thing is in.                 |
| `density`   | rows: `dense` 28, `compact` 32, `default` ≥40    | Rows and bars only.                       |

Icons inside a kit control take their size from its rung — do not add `size-*` to them.

## 3. Paint with tokens

Text: `text-foreground`, `text-text-strong`, `text-text-soft`, `text-text-faint`. Fills are veils:
`bg-surface-hover`, `bg-surface-active`, `bg-field-fill`, `bg-foreground/[0.04]`. Status:
`text-status-error|warning|success|info`. Charts: `--chart-N`. Radius: `rounded-sm`, `rounded-md`,
`rounded-full`. Motion: `duration-(--dur-*)`, `ease-(--ease-*)`. Heights: `h-(--chrome-control-*)`.

Never: a palette class (`text-red-500`), a hex colour, `h-[30px]`, bare `rounded`, `duration-200`,
`z-10`, a pane-sized background, a second `focus-visible:ring-*`. The full contract and its reasons:
`docs/internals/visual-system.md`.

## 4. Check it

From the repository root, run only what you touched:

```bash
bun test scripts/ui-token-drift-guard.test.ts scripts/pane-ground-guard.test.ts
bun test <your component's test file>
cd apps/ui && npx tsc -b          # or: cd packages/kit && npx tsc --noEmit
```

Then look at it in the running app (`bun run dev`), light and dark, narrow and wide. A plugin view
is reachable by the browser tool at `plugin:<name>`.

## 5. When the kit lacks something

Do not build it locally in a feature or a plugin. Add it to the kit following
`packages/kit/AGENTS.md`: implementation in its category folder, a door in `src/entries/<id>.ts`, a
catalog entry (the catalog test fails without one), a test, a line in `docs/extending/ui-kit.md`. If
it needs host state, it is a host composite in `apps/ui/src/shared/ui`, lent through
`apps/ui/src/app/kit/<id>.ts` — read that directory's README.
