# Modules the host lends

`@localixai/kit/<id>` is served from two places. Most ids are doors of the kit package,
`packages/kit/src/entries/<id>.ts` — the primitives the app itself imports. The ids in this
directory are the ones the kit package cannot hold, because they are bound to a host feature: the
code editor (Monaco, the app's editor preferences), Markdown (file and mention links through the
inspector), diffs, code blocks (run in terminal, insert snippet), comments, tool cards, the chat
composer's buttons, file icons with plugin-contributed icons, external links through the host's
confirmation, the theme and platform reads, and user settings.

A plugin imports them exactly like a kit door; the registry (`app/pluginSharedModules.ts`) serves
both directories, and its test refuses an id in both. The kit catalog describes these modules too
(`provider: 'host'`), pinned by `app/kitCatalog.test.ts`.

## Rules

- Explicit exports only (`export { … } from '@/…'`, `export type { … }`), never `export *`: the file
  is the contract, and the plugin kit staging reads its names.
- Adding a module or a name here is the review: state, clients, feature components, hooks and
  contribution registries stay private. A module that exposes host FEATURE state (`user-settings`)
  is recorded debt in `scripts/check-architecture.mjs`, importable only from the files listed there.
- A module whose feature dependency can be replaced by a port — the kit reads a store or a DOM
  attribute the host writes, the way `keyboard/chord-store.ts` carries resolved chords — moves into
  the kit package instead of staying here. That is the direction; this directory should shrink.
- `testing/` is the host's test harness for plugins (`registerDom`, the host buses, `host-runtime`);
  it is never part of a runtime artifact.
