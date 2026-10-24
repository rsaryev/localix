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

`scripts/architecture-rules.test.ts` enforces X1, with a baseline in
`scripts/architecture-baselines/x1.json` that only shrinks and is now empty: the `localix://`
address grammar both sides name lives in `packages/uri` (the SDK re-exports it for mini apps). The
loaders enforce X2.

## Plugins

| Part     | Where                                                                                                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format   | `packages/claude-plugin` (`@localixai/claude-plugin`): Claude Code's documented format.                                                                                                       |
| Runtime  | `apps/api/src/features/plugins/`: discovery, loading, marketplaces, enable state, versions and updates.                                                                                       |
| Disk     | `~/.localix/plugins/<name>/`, `~/.localix/plugins/cache/<marketplace>/<plugin>/<version>/`, `<project>/.localix/plugins/<name>/`, plugin data folders.                                        |
| Built-in | The repository's `plugins/<name>/`, staged into `resources/builtin-plugins/`: Claude Code plugins listed as Built-in (source `builtin`), on by default, switchable off, updated with Localix. |
| Surfaces | `/rpc/plugins` (with `/rpc/plugins/updates`), Settings → Capabilities → Plugins, `/plugin`.                                                                                                   |
| Agent    | Skills, commands and agents, namespaced `/<plugin>:<name>` as in Claude Code.                                                                                                                 |

A part Claude Code defines and Localix does not run is reported in the plugin's validation, never
dropped silently. A key Claude Code does not define is a validation warning, as in Claude Code.

A built-in plugin is still only a plugin. The first one, `localix-mini-apps`, teaches an agent to
build mini apps in plain Markdown — a skill and commands that name `/mini-app create`,
`mini_app_build` and the repository's scripts — and imports no Localix code, so X1 and X2 hold: no
code path joins the two layers, and its folder holds no `mini-app.json`. Staging keeps them apart
too: a folder under `plugins/` whose only manifest is `.claude-plugin/plugin.json` is never staged
as a mini app.

A mod must get what Claude Code gives it. `scripts/cc-parity/` runs one probe mod in the installed
Claude Code and in Localix's mods host and compares the shapes each hands it, per event and `$`
call; `parity.test.ts` holds the entries known to match. See its
[README](../../scripts/cc-parity/README.md) for the rules and for updating after a release.

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
- `guide.md` tells the agent which tool does what and what to tell the person. It is read on demand:
  the prompt lists each enabled mini app in one line, marked when it has a guide, and the agent
  reads one with `mini_app_guide` before it first uses the app (as it reads a skill). It replaces
  the skills a mini app used to carry.
- A **command** is declared in `mini-app.json`: its `prompt` (with `${name}` for each argument),
  `description`, `args` with chips and pickers, `featured`, and the tools it switches on
  (`activateTools`). It runs as `/<app>:<command>`.
- A tool's description says what the tool does; `guide.md` says when to use it.

### Runtime

| Part     | Where                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| SDK      | `packages/mini-app-sdk` (`@localixai/mini-app-sdk`): manifest, backend and UI contracts. The host serves its modules. |
| Runtime  | `apps/api/src/features/mini-apps/`: catalog, install and update, backend host, UI artifacts, views, authoring.        |
| Disk     | `~/.localix/mini-apps/<name>/` (the installed build) and `~/.localix/mini-apps-data/<name>/` (its state).             |
| Surfaces | `/rpc/mini-apps`, Settings → Capabilities → Mini apps, `/mini-app`.                                                   |
| Agent    | Backend tools, `guide.md`, commands, the `mini_app_build` tool.                                                       |

### State and events

Mini apps follow the [architecture](architecture/README.md) like any owned model (P5, P7, P11):

- `features/mini-apps` is the one owner of the `mini-app` entity, `{ id: <name>, scope }`. Every
  install, update, removal and settings change records that notice; whether one may run is a
  `capability.rule` notice (`mini-app:<name>`).
- The relay turns a `mini-app` notice into the `mini-apps` client resource and moves the capability
  revision. Every surface (the rail, Settings → Mini apps, the catalog) re-reads the list from the
  owner; none patches another's state (C6).
- The backend host, the channel host and the contribution sync are reactors on those notices, each
  with its own cursor, never a callback from the writer (C5).
- An install or update in flight is in-memory status: the Store indexes its job and pokes `store`,
  and the client pulls the Store's activity (`/rpc/store/activity`), as the local models do.

### Package format v1

What a mini app is, fixed so a host can install, update and refuse one without running it:

- **`mini-app.json`** (strict schema): `name` is the identity, `version` (semver) the only version,
  `apiVersion` the host API it was built against.
- **The archive** a catalog distributes: `mini-app.json`, `guide.md`, `guide/`, `icon.svg`,
  `dist/backend/` and `dist/ui/`. Built code only: no source, no `node_modules`, nothing for the
  person's machine to build. The icon the manifest names travels in it; the screenshots and README
  are published beside it as pinned store media, served to the page only by the host.
- **`.localix-install.json`**, written beside an installed copy: its source, version, sha256 and
  install time. A folder without it is the person's own mini app, which no catalog updates or
  removes.

### Catalogs and sources

A catalog is a `catalog.json` index of archives. It lists the first-party mini apps and, later,
those of other authors; each entry names its publisher and whether it is **verified**:

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
      "publisher": { "name": "Localix", "verified": true },
      "archive": { "url": "chess-0.3.0-3fa1c2d4e5b6.tar.gz", "bytes": 182340, "sha256": "…" }
    }
  ]
}
```

| Source                | What it is                                                | Updates                     |
| --------------------- | --------------------------------------------------------- | --------------------------- |
| HTTPS catalog         | `catalog.json` and archives; Localix's own is the default | by version, automatically   |
| Git repository        | its release assets, read as an HTTPS catalog              | by version, automatically   |
| Local catalog folder  | `catalog.json` and archives on disk, read as `file://`    | by version, automatically   |
| Local mini app folder | one mini app's source: developer mode                     | rebuilt by the host on save |

Only developer mode builds on the person's machine; every other source ships built archives.

### Releasing, installing, updating

1. **Release.** The author raises `version`; packing (CI for the first-party ones) builds the
   archive and writes its catalog entry. The same version with other content is refused by its
   sha256.
2. **Choose.** The [Store](store.md) is its own workspace tab, opened on its Mini apps shelf from
   the rail's add button, from setup and from Settings → Mini apps. The mini apps provider
   (`store-provider.ts`) serves the catalogs' offers through the Store's port. Category tabs, a tag
   filter and a sources menu, then Featured, Updates, Installed and Available as cards: the app's
   own icon, name, what is inside, description, tags, publisher when not verified, and Install and
   Install as app, Update, Remove or the download's progress. A card opens the app's page:
   screenshots, README, contents, plan and versions. Install and update reuse the local models'
   pinned download (`lib/pinned-download.ts`).
3. **Install.** One queue downloads each archive with progress (resumable, size-capped, verified
   against the catalog's sha256 before anything is unpacked), unpacks it beside the installed copy
   and swaps it in with one rename. A failed install leaves the previous build.
4. **Update.** A minute after start and every six hours the catalogs are re-read, and a newer
   version with a compatible `apiVersion` is installed for every app a catalog put there; an
   incompatible one says Localix needs updating. A failed download or archive leaves the previous
   build. An update never touches the app's data folder.
5. **Trust.** Installing from the store is the person's yes to run the app. An unverified publisher
   is named in the row, and its install asks again first.
6. **Create.** `mini_app_build` forks the template into `~/.localix/mini-apps/<name>/` and builds it
   with the host's build: the person's own app, updated by no catalog.

In development the catalog is built from the checkout, so a change to `mini-apps/` is installed
without a release.

## Migration

None: mini apps start clean. Their settings, secrets and data live under new names
(`mini-app-option.`, `mini-app:` rules, `mini-apps-data/`); what earlier versions kept under the
plugin names is no longer read. The managed copies earlier versions synchronized into
`~/.localix/plugins/` are removed on start.

## Status

| Phase | Change                                                                                               | State |
| ----- | ---------------------------------------------------------------------------------------------------- | ----- |
| 0     | This contract; Workflows removed.                                                                    | Done  |
| 1     | `mini-app.json` and `guide.md`; the bundled mini apps converted; no `.claude-plugin/` in a mini app. | Done  |
| 2     | `features/mini-apps` split from `features/plugins`; the composed manifest and legacy layout removed. | Done  |
| 3     | Separate storage, records, routes, settings and model-facing names; the start-up migration.          | Done  |
| 4     | Release archives, `catalog.json`, the install and update queue, the picker; nothing bundled.         | Done  |
| 5     | Tests, guards, screenshots, docs and copy that assumed bundled mini apps.                            |       |
