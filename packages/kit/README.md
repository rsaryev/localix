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
- **Brand mark attribution:** [NOTICE.md](NOTICE.md), covering the paths used by coding-agent marks.

## Entry points

| Import                          | Contract                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `@localixai/kit/<id>`           | A component or helper module declared in `src/entries/<id>.ts`; no package-root barrel. |
| `@localixai/kit/styles.css`     | The shared stylesheet cascade from `styles/index.css`; imported by the host.            |
| `@localixai/kit/catalog`        | The module catalog used by plugin authoring and documentation.                          |
| `@localixai/kit/testing/<name>` | Source-level test helpers; use only in tests.                                           |

The package exports TypeScript source and CSS. It has no build script or compiled `dist` entry; the
application and plugin compiler bundle the appropriate entry points.

## Layout

| Path                  | Holds                                                                 |
| --------------------- | --------------------------------------------------------------------- |
| `src/entries/<id>.ts` | Component/helper entry modules, each an explicit re-export list.      |
| `src/controls/`       | Buttons, fields, pickers, toggles.                                    |
| `src/overlays/`       | Dialogs, popovers, menus, tooltips, the command palette.              |
| `src/layout/`         | Headers, toolbars, tabs, status bars, sections, resizing.             |
| `src/lists/`          | Rows, trees, key/value details, reordering, drop targets.             |
| `src/feedback/`       | Empty and error states, notices, progress, status dots, chips, stats. |
| `src/content/`        | Matched text, logs, JSON, avatars, file chips.                        |
| `src/keyboard/`       | Keycaps, chord hints, the chord engine and the live chord store.      |
| `src/canvas/`         | The one board every graph is drawn on.                                |
| `src/lib/`            | Platform reads and small shared helpers.                              |
| `src/testing/`        | Test-only harnesses (`@localixai/kit/testing/<name>`).                |
| `src/catalog/`        | The catalog and its completeness test.                                |
| `styles/`             | Tokens, themes and style layers; `styles/index.css` is the cascade.   |

## Checks

Choose checks for the changed contract. For a catalog or token change:

```bash
bun test packages/kit/src/catalog/catalog.test.ts
bun test scripts/ui-token-existence-guard.test.ts scripts/ui-token-drift-guard.test.ts
```

For a component change, run its colocated test; use the shared DOM harness when interaction or
accessibility requires rendered evidence. Documentation-only changes need documentation validation.
The full kit suite, package type check and repository architecture gate belong to CI; run an
individual gate locally when it answers a concrete question or is explicitly requested.

## Source of truth

- [Package exports and scripts](package.json)
- [Component and helper entry points](src/entries/)
- [Catalog completeness contract](src/catalog/catalog.test.ts)
- [Shared stylesheet cascade](styles/index.css)
