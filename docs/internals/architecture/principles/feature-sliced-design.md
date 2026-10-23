# Feature-Sliced Design

Feature-Sliced Design organises a frontend into ranked layers, business slices and purpose segments,
with imports allowed only downward. `apps/ui` follows its layers; this note records which of its
rules are enforced and which are not.

## Source

Feature-Sliced Design, "Overview" and "Layers" reference, plus the "Public API" reference.

- <https://feature-sliced.design/docs/get-started/overview>
- <https://feature-sliced.design/docs/reference/layers>
- <https://feature-sliced.design/docs/reference/public-api>

## What the source says

There are seven layers from top to bottom: app, processes (deprecated), pages, widgets, features,
entities and shared. A project need not use all of them. Layers are split into slices by business
domain, and slices into segments by technical purpose such as `ui`, `api`, `model`, `lib` and
`config`. App and shared have no slices; their segments may import each other.

The import rule reads: "A module (file) in a slice can only import other slices when they are
located on layers strictly below." Slices on the same layer do not import each other. Entities may
cross-reference through an explicit `@x` file.

Each slice exposes a public API, usually an index file that re-exports what outsiders may use. Deep
imports past it expose internals and make refactoring harder.

## Rules we take

- Import only from layers strictly below: app > pages > widgets > features > entities > shared.
- Do not import from another slice on the same layer; lift the shared piece to a lower layer or pass
  it through a port or prop.
- Import a slice through its public entry, not through `model/` or `ui/` internals.
- Name segments by purpose (`ui`, `model`, `api`, `lib`), not by kind (`components`, `hooks`).
- Keep `apps/ui` out of `apps/api` sources; use the export-map leaves of `@localixai/api`.

## How Localix applies it today

`apps/ui/src` has `app`, `pages`, `widgets`, `features`, `entities` and `shared`. `entities/chat`
(the chat store, transcript and composer) and `entities/workspace-grid` (the grid store) hold what
several features read; `features/chat` and `features/workspace-grid` keep only their contributions.
`uiLayers` and `uiLayer` in `scripts/check-architecture.mjs` rank them, and the checker reports "FSD
<layer> cannot import outward from <layer>" for an upward import. The same script reports a relative
import from `apps/ui/src` into `apps/api`, and a browser import of
`@localixai/mini-app-sdk/backend`.

Slices use purpose segments, for example `apps/ui/src/entities/chat/model` and
`apps/ui/src/entities/chat/ui`. Plugin UI meets the host through the kit, checked by
`miniAppHostBoundaryProblem`.

## Known gaps

- Same-layer slice imports are checked by A8 in `scripts/architecture/flow-rules.ts`, with an empty
  baseline. Test files are not counted.
- Public APIs are not enforced. Feature slices have no `index.ts`, and other layers import paths
  such as `@/entities/chat/model/store` directly.
- In widgets, one same-layer edge exists: `editor-grid` imports `chat-workspace`.
- Related: [layering](layering.md), [package principles](package-principles.md).
