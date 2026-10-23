# Plugins and mini apps

Localix has two kinds of extension, and they share nothing: no manifest, no folder, no record, no
route, no settings form and no code path.

- A **plugin** is a Claude Code plugin, read exactly as Claude Code reads it: skills, commands,
  agents, hooks and a hooks module (a mod), MCP and LSP servers, monitors, output styles, themes,
  `bin/`, `settings.json` and `userConfig`. Localix is one more host for that format. A plugin
  folder that loads in Claude Code loads in Localix, and the reverse.
- A **mini app** is a Localix application: screens, a native backend, agent tools over Localix's
  APIs, a guide for the agent and commands with pickers. It is Localix's own format and means
  nothing to Claude Code.

A mini app does not contain, name or depend on a plugin, and a plugin knows nothing of mini apps.

This page is the contract for the split. The status table at the end says what is already true.

## Rules

| Id  | Rule                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | `features/plugins` and `features/mini-apps` never import each other; `packages/claude-plugin` and `packages/mini-app-sdk` never import each other. Machinery both need (pinned downloads, archives, git) lives in a neutral lib. |
| X2  | A folder is one or the other. A mini app folder holds no `.claude-plugin/`; a plugin folder holds no `mini-app.json`. The loader refuses a folder with both and says why.                                                        |
| X3  | Each layer has its own records, routes, storage, settings page, slash command and model-facing names. Nothing is "an extension" that could be either.                                                                            |
| X4  | The core names no mini app. A feature that needs one (a task board) asks for a capability a mini app declares, never for a mini app by name.                                                                                     |
| X5  | Localix ships no mini app. Every mini app, first-party included, is installed and updated from a catalog.                                                                                                                        |

`scripts/check-architecture.mjs` enforces X1 and X4; the loaders enforce X2.

## Plugins

| Part     | Where                                                                                    |
| -------- | ---------------------------------------------------------------------------------------- |
| Format   | `packages/claude-plugin` (`@localixai/claude-plugin`): Claude Code's documented format.  |
| Runtime  | `apps/api/src/features/plugins/`: discovery, loading, marketplaces, enable state.        |
| Disk     | `~/.localix/plugins/<name>/`, `<project>/.localix/plugins/<name>/`, plugin data folders. |
| Surfaces | `/rpc/plugins`, Settings → Plugins, `/plugin`.                                           |
| Agent    | Skills, commands and agents, namespaced `/<plugin>:<name>` as in Claude Code.            |

A part Claude Code defines and Localix does not run is reported in the plugin's validation, never
dropped silently. A key Claude Code does not define is a validation warning, as in Claude Code.

## Mini apps

### Format

```text
chess/
  mini-app.json      name, version, apiVersion, category, backend, commands, settings
  guide.md           what the agent needs to know to use the app
  icon.svg
  backend/index.ts   register(ctx): tools, routes, services, channels, hooks
  ui/register.tsx    the screens
  shared/            code the backend and the UI both import
```

- `mini-app.json` is the only manifest, validated by `packages/mini-app-sdk/src/manifest/`.
- `guide.md` is a prompt section the agent reads while the mini app is enabled: which tool does
  what, and what to tell the person. It is bounded in size and replaces the skills a mini app used
  to carry.
- A **command** is declared in `mini-app.json`: its `prompt` (with `$name` for each argument),
  `description`, `args` with chips and pickers, `featured`, and the tools it switches on
  (`activateTools`). It runs as `/<app>:<command>`.
- A tool's description says what the tool does; `guide.md` says when to use it.

### Runtime

| Part     | Where                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| SDK      | `packages/mini-app-sdk` (`@localixai/mini-app-sdk`): manifest, backend and UI contracts. The host serves its modules. |
| Runtime  | `apps/api/src/features/mini-apps/`: catalog, install and update, backend host, UI artifacts, views, authoring.        |
| Disk     | `~/.localix/mini-apps/<name>/` (the installed build) and `~/.localix/mini-apps-data/<name>/` (its state).             |
| Surfaces | `/rpc/mini-apps`, Settings → Mini apps, `/mini-app`.                                                                  |
| Agent    | Backend tools, `guide.md`, commands, the `mini_app_build` tool.                                                       |

### Distribution

The source of every first-party mini app stays in `mini-apps/` of this repository. Localix does not
ship them; a release publishes them.

1. **Release.** CI builds each mini app into an archive: the backend bundle, the UI artifact,
   `mini-app.json`, `guide.md` and the icon. Nothing in it needs a build tool or `node_modules` on
   the person's machine. Beside the archives it publishes `catalog.json`:

   ```json
   {
     "schemaVersion": 1,
     "apps": [
       {
         "name": "chess",
         "displayName": "Chess",
         "version": "0.3.0",
         "apiVersion": 1,
         "category": "games",
         "description": "Legal moves and agent-opponent play.",
         "archive": { "url": "https://…/chess-0.3.0.zip", "bytes": 182340, "sha256": "…" }
       }
     ]
   }
   ```

2. **Choose.** On first start, and at any time in Settings → Mini apps, the person picks what to
   install from the catalog.
3. **Install.** One queue downloads each archive with progress (resumable, size-capped, verified
   against the catalog's sha256 before anything is unpacked), unpacks it into a staging folder and
   moves it into place in one rename. A failed or cancelled install leaves the previous build.
4. **Update.** The catalog is checked periodically. A newer version with a compatible `apiVersion`
   is offered with an Update action, or installed on its own when automatic updates are on. An
   update replaces the build, never the data folder.
5. **Create.** `mini_app_build` (and `/mini-app create`) forks the template into
   `~/.localix/mini-apps/<name>/` and builds it with the host's build. A mini app the person made is
   theirs: the catalog never updates or removes it.

A mini app from the first-party catalog is trusted on install; one from any other source runs its
backend and screens only after the person enables it.

In development the catalog is built from the checkout, so a change to `mini-apps/` is installed
without a release.

## Migration

On the first start of a version with the split, once, and safe to run again:

- The bundled copies earlier versions synchronized into `~/.localix/plugins/` are removed.
- Each mini app the person made in `~/.localix/plugins/` moves to `~/.localix/mini-apps/`, rewritten
  to `mini-app.json` and `guide.md`, with its imports moved to `@localixai/mini-app-sdk`. The
  original is kept under `~/.localix/backups/`.
- Mini app state moves from `plugin-state/` and `plugin-data/` to `mini-apps-data/`.
- The first-party mini apps that were enabled are preselected in the picker.

## Status

| Phase | Change                                                                                               | State |
| ----- | ---------------------------------------------------------------------------------------------------- | ----- |
| 0     | This contract; Workflows removed.                                                                    | Done  |
| 1     | `mini-app.json` and `guide.md`; the bundled mini apps converted; no `.claude-plugin/` in a mini app. |       |
| 2     | `features/mini-apps` split from `features/plugins`; the composed manifest and legacy layout removed. |       |
| 3     | Separate storage, records, routes, settings and model-facing names; the start-up migration.          |       |
| 4     | Release archives, `catalog.json`, the install and update queue, the picker; nothing bundled.         |       |
| 5     | Tests, guards, screenshots, docs and copy that assumed bundled mini apps.                            |       |
