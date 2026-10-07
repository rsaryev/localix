# The UI kit

`@localixai/kit` is the one set of controls, overlays, rows, states, class recipes and design tokens
that the Localix workbench and every plugin view are built from. Use this page to find the module
for a job, learn the shared size and tone vocabulary, and add to the kit without forking it.

## Terminology

| Term           | Meaning                                                                            | Boundary                                                         |
| -------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Kit            | The source package `packages/kit`, imported as `@localixai/kit/<id>`.              | Presentation only: no network, no app state, no feature names.   |
| Door           | One public module, `packages/kit/src/entries/<id>.ts`: an explicit re-export list. | Anything not re-exported by a door is private to the kit.        |
| Lent module    | A module the app serves under the same namespace, `apps/ui/src/app/kit/<id>.ts`.   | Bound to a host feature (the code editor, Markdown, tool cards). |
| Catalog        | Every module with the job it is for, in `packages/kit/src/catalog/`.               | Tests pin it to the doors and lent modules in both directions.   |
| `KIT.md`       | The catalog rendered as Markdown, written into a user plugin by every build.       | Generated; an edit is overwritten on the next build.             |
| Control ladder | The heights `xs` 20, `sm` 24, `md` 28, `lg` 32, `xl` 36 px.                        | A size name means the same height on every primitive.            |

## What you can do

| Task                                | Do this                                                                       | Boundary                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Find the module for a job           | Look the job up in the catalog (below, or `KIT.md` in a user plugin's folder) | Build nothing the kit has; the house-style check reports drift.   |
| Import a primitive in the app       | `import { Button } from '@localixai/kit/button'`                              | Never `@/shared/ui/…` for a primitive: it lives in the kit now.   |
| Import a primitive in a plugin      | The same specifier; the build takes the module from the running host          | One instance: a plugin never bundles its own copy of the kit.     |
| Size a control                      | `size="sm"` — a rung name                                                     | Never a height in `className`.                                    |
| Mark an action destructive          | `tone="danger"` (IconButton), `variant="danger"` (Button)                     | `danger` is for what a click does, never for a state.             |
| Suggest the next step               | `recommended` on the one `Button` that is the safe, expected next action      | Never on a permission grant, a destructive act, or a busy run.    |
| Show a state                        | A status tone: `neutral`, `info`, `success`, `warning`, `error`               | `error` is for what went wrong, never for a button.               |
| Colour anything                     | A token utility (`text-text-soft`, `bg-surface-hover`, `--chart-N`)           | No palette class, no hex; see [Visual system][visual].            |
| Add a primitive                     | Follow `packages/kit/AGENTS.md`: file, door, catalog entry, test              | A door without a catalog entry fails the kit's tests.             |
| Use a host feature in a plugin view | A lent module: `@localixai/kit/code-editor`, `markdown`, `diff`, `tool-card`  | Lent modules keep the host feature's behaviour and state.         |
| Check a view like the build does    | `bun test scripts/ui-token-drift-guard.test.ts` in the repository             | User plugins get the same rules from `plugin_build`'s style step. |

### Choose by job

The full catalog has about a hundred modules; these are the jobs that are most often hand-rolled.

| Job                                      | Module                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| A command with a label / with an icon    | `button` / `icon-button`                                                   |
| A text or number field                   | `input` inside `field`; `textarea`; `search-input` for filtering           |
| Structured prose with formatting         | `rich-text`: `RichTextEditor` inside `field`; `rich-text-view` for viewing |
| Visual template choices                  | `selection-tile` with an actual `document-thumbnail`                       |
| A value in a form saved with others      | `select` (a few) / `combobox` (many, searchable)                           |
| A pick in chrome (a mode, an agent)      | `menu-entries` rows with `selected` in a `dropdown-menu`                   |
| Switching what a pane shows (2–4 views)  | `@localixai/plugin-sdk/ui/segmented-control`                               |
| A status tone on a menu row's icon       | `tonedIcon` from `@localixai/plugin-sdk/ui`                                |
| An agent or person in a menu row         | `monogramIcon` from `@localixai/kit/avatar`                                |
| An on/off setting / a filter chip        | `switch` / `toggle-pill`; `checkbox` inside forms                          |
| A pane header, toolbar, status row       | `panel-header`, `workbench-toolbar`, `workbench-statusbar`                 |
| Tabs inside a pane                       | `tabs` (`TabBar`, `TabStrip`)                                              |
| A long navigation path                   | `workbench-breadcrumb` with `scrollable` and `scrollToEndKey`              |
| A navigable row, a tree                  | `workbench-list-row` with `tree-navigation`                                |
| Metadata that gives way to row actions   | `WorkbenchListRowActions` with `visibility="hover"` and `fallback`         |
| A table of records                       | `TableGrid` from `@localixai/plugin-sdk/ui/components`                     |
| Nothing to show yet / a failure          | `empty-hint` (one line), `state-notice` (centred, with actions)            |
| Progress, a live dot, a count badge      | `progress-bar`, `pulsing-dot`, `chip`                                      |
| "Copied", "Nothing to undo" at a control | `action-feedback` (transient, never the journal)                           |
| A dialog, a confirmation                 | `dialog` (its `size` is the width), `confirm-dialog`                       |
| A menu under a button and on right-click | `menu-entries` over `dropdown-menu` and `context-menu`                     |
| A menu of choices that need explaining   | `menu-entries` rows with `description` (a line under the label)            |
| One choice among several in a menu       | `menu-entries` rows with `selected` (icon kept, check at the end)          |
| Several on/off choices in a menu         | `menu-entries` rows with `checked` (drawn like `selected`)                 |
| A pick that should not close the menu    | `menu-entries` rows with `keepOpen` (a submenu `hint` shows it)            |
| An inline action beside a menu choice    | `menu-entries` rows with `trailingAction` (independent, stays open)        |
| A resizable split                        | `pane-resize` with `WorkbenchSash` from `button`                           |
| A chart                                  | `@localixai/plugin-sdk/ui/charts`                                          |
| A graph or a board                       | `canvas`                                                                   |

## How it works

Use `ClaudeMark`, `CodexMark`, `GeminiMark`, `CopilotMark`, `OpenCodeMark` and `HermesMark` from
`@localixai/kit/coding-agent-marks` for coding agent identities. These monochrome SVGs inherit the
surrounding text colour. Menus, session rows and resource references share the same marks.

### One package, two consumers

The primitives live in one package rather than inside the app, because a facade of re-exports would
make "the kit" a list the app happened to maintain: the app would import internals the facade did
not list, and nothing would stop a primitive from reading app state. As a package, its boundary is
checked like any package's — `scripts/check-architecture.mjs` refuses a kit file that imports the
app — and the app imports the same doors a plugin does. What the app sees is what a plugin gets.

The package is source only. The app's Vite build compiles it with the app, React Compiler included,
and a plugin's artifact build turns each `@localixai/kit/<id>` import into a load of the host's
module, so the host, the app and every plugin share one instance of each primitive and of the
libraries behind them (Radix, cmdk, the flow canvas). The registry of those modules,
`apps/ui/src/app/pluginSharedModules.ts`, is built from the doors and the lent modules; its test
refuses an id served by both.

### The kit owns the design system

The tokens and style layers are in `packages/kit/styles/`, in the cascade order
`packages/kit/styles/index.css` states. The app's stylesheet imports it with one line, and the
plugin kit stages it so a plugin's utilities are compiled against the same theme. The rules that
keep a surface on that system — no palette colour, no literal duration, the radius scale, one focus
recipe, no pane-sized ground — are the ones [Visual system][visual] lists; each is a check that
scans the kit as well as the app and the bundled plugins.

### One vocabulary for every primitive

Three axes carry the same names everywhere, so a caller never has to look up which word a component
chose:

| Axis        | Values                                           | Meaning                                                 |
| ----------- | ------------------------------------------------ | ------------------------------------------------------- |
| Size        | `xs`, `sm`, `md`, `lg`, `xl`                     | A rung of the control ladder; `md` is 28px everywhere.  |
| Action tone | `default`, `danger`                              | What a click does. Buttons, icon actions, menu items.   |
| Status tone | `neutral`, `info`, `success`, `warning`, `error` | What state a thing is in. Chips, notices, dots, badges. |

### One look for a menu row that can be chosen

A described menu has two kinds of choice row: `selected` for one choice among several (announced as
`menuitemradio`) and `checked` for a real multi-select or an on/off toggle (announced as
`menuitemcheckbox`). Both are drawn the same way — the row's icon in the leading slot, the check at
the END of the row, and on an unchosen row that end slot kept empty so hints still line up.

A checkbox row that put its check in the leading slot would take the icon's place: a filter menu of
status dots or severities would show bare names while a single-choice menu beside it kept its icons.
Only the role tells the two kinds apart; pick by what the choice means, never by how it should look.

### The catalog is the answer to "which module?"

A list of exports and props does not say which module a job needs. The plugin authoring agent was
once given the props of sixteen controls and nothing else, and it hand-rolled tabs, a checkbox and a
progress bar the kit already had. The catalog states each module's job and what not to confuse it
with. The plugin kit renders it into `KIT.md`, every `plugin_build` writes that file into the
plugin's folder the way it writes `tsconfig.json`, and the `/plugin create` instruction tells the
agent to choose there before writing a control.

## Configuration

| Where                                    | Owns                                                               |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `packages/kit/src/entries/`              | The doors: what `@localixai/kit/<id>` exports.                     |
| `packages/kit/src/catalog/`              | The catalog and its completeness test.                             |
| `packages/kit/styles/`                   | Tokens, themes, window material, motion, utilities, accessibility. |
| `packages/kit/AGENTS.md`                 | The rules for changing the kit.                                    |
| `apps/ui/src/app/kit/`                   | The modules the host lends, and the recorded debt among them.      |
| `apps/ui/src/app/pluginSharedModules.ts` | The runtime registry plugins load the kit from.                    |
| `scripts/stage-plugin-kit.mjs`           | What an installed app ships to build plugins, `KIT.md` included.   |

## Limits

- The kit's doors list only the names something imports today. A new use of an internal name is a
  door edit, which is the review point, not a defect.
- Fourteen modules are still lent by the host because they carry host features: Markdown, the code
  editor, diffs, code blocks, comments, tool cards and a few others. They keep the host's behaviour;
  moving them into the kit needs a port for the host service each one reads.
- The checks read class strings and source; a class assembled at runtime from variables passes
  unchecked.

## Related guides

- [Build workbench UI](plugin-ui.md) — the artifact, `/plugin create` and `plugin_build`.
- [Visual system][visual] — the paint contract and the checks behind it.

## Source of truth

- [`packages/kit/src/entries/`](https://github.com/rsaryev/localix/tree/main/packages/kit/src/entries)
  — the public modules.
- [`packages/kit/src/catalog/index.ts`](https://github.com/rsaryev/localix/blob/main/packages/kit/src/catalog/index.ts)
  — the catalog.
- [`packages/kit/styles/index.css`](https://github.com/rsaryev/localix/blob/main/packages/kit/styles/index.css)
  — the layer order.
- [`apps/ui/src/app/pluginSharedModules.ts`](https://github.com/rsaryev/localix/blob/main/apps/ui/src/app/pluginSharedModules.ts)
  — the runtime registry.

[visual]: ../internals/visual-system.md
