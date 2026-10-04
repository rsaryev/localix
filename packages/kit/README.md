# @localixai/kit

The Localix UI kit: the controls, overlays, rows, states, class recipes and design tokens the
workbench and every plugin view are built from. The app and plugins import the same modules,
`@localixai/kit/<id>`; a plugin takes them from the running host, so there is one instance of each.

```ts
import { Button } from '@localixai/kit/button'
import { EmptyHint } from '@localixai/kit/empty-hint'
```

- **Which module for which job:** the catalog, `src/catalog/`, published as
  [docs/extending/ui-kit.md](../../docs/extending/ui-kit.md) and, for a user plugin, as `KIT.md` in
  its folder.
- **The paint contract:** [docs/internals/visual-system.md](../../docs/internals/visual-system.md).
- **Changing the kit:** [AGENTS.md](AGENTS.md).

## Layout

| Path                  | Holds                                                                 |
| --------------------- | --------------------------------------------------------------------- |
| `src/entries/<id>.ts` | The doors — the only public modules, each an explicit re-export list. |
| `src/controls/`       | Buttons, fields, pickers, toggles.                                    |
| `src/overlays/`       | Dialogs, popovers, menus, tooltips, the command palette.              |
| `src/layout/`         | Headers, toolbars, tabs, status bars, sections, resizing.             |
| `src/lists/`          | Rows, trees, key/value details, reordering, drop targets.             |
| `src/feedback/`       | Empty and error states, notices, progress, status dots, chips, stats. |
| `src/content/`        | Matched text, logs, JSON, avatars, file chips.                        |
| `src/keyboard/`       | Keycaps, chord hints, the chord engine and the live chord store.      |
| `src/canvas/`         | The one board every graph is drawn on.                                |
| `src/lib/`            | Platform reads and small shared helpers.                              |
| `src/testing/`        | The test harness (`@localixai/kit/testing/<name>`), never shipped.    |
| `src/catalog/`        | The catalog and its completeness test.                                |
| `styles/`             | Tokens, themes and style layers; `styles/index.css` is the cascade.   |

## Checks

```bash
bun test packages/kit                    # the kit's own tests, catalog included
cd packages/kit && npx tsc --noEmit      # types
bun test scripts/ui-token-drift-guard.test.ts scripts/pane-ground-guard.test.ts
bun run check:architecture               # the kit imports no app code
```
