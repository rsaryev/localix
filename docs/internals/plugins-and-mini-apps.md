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

Localix's own plugins and mini apps are not in this repository. They live in the
[Localix marketplace](https://github.com/rsaryev/localix-marketplace) and install, update and are
trusted from its catalog like anyone's. The core knows only that repository, as a trusted default
source (`LOCALIX_MARKETPLACE` in `packages/store/src/default-sources.ts`), and names none of its
plugins or mini apps. What the core publishes for them is the mini app SDK and the mini app kit.

## Rules

| Id  | Rule                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | `features/plugins` and `features/mini-apps` never import each other; `packages/claude-plugin` and `packages/mini-app-sdk` never import each other. Machinery both need (pinned downloads, archives, git) lives in a neutral lib. |
| X2  | A folder is one or the other. A mini app folder holds no `.claude-plugin/`; a plugin folder holds no `mini-app.json`. The loader refuses a folder with both and says why.                                                        |
| X3  | Each layer has its own records, routes, storage, settings page, slash command and model-facing names. Nothing is "an extension" that could be either.                                                                            |
| X4  | The core names no mini app. A feature that needs one (a task board) asks for a capability a mini app declares, never for a mini app by name.                                                                                     |
| X5  | Localix ships no mini app and hosts no catalog. Every mini app, first-party included, is installed and updated from a catalog; Localix's own come from the Localix marketplace.                                                  |

`scripts/architecture-rules.test.ts` enforces X1, with a baseline in
`scripts/architecture-baselines/x1.json` that only shrinks and is now empty: the `localix://`
address grammar both sides name lives in `packages/uri` (the SDK re-exports it for mini apps). The
loaders enforce X2.

## Plugins

| Part          | Where                                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format        | `packages/claude-plugin` (`@localixai/claude-plugin`): Claude Code's documented format.                                                                              |
| Runtime       | `apps/api/src/features/plugins/`: discovery, loading, marketplaces, enable state, versions and updates.                                                              |
| Disk          | `~/.localix/plugins/<name>/`, `~/.localix/plugins/cache/<marketplace>/<plugin>/<version>/`, `<project>/.localix/plugins/<name>/`, plugin data folders.               |
| Localix's own | The Localix marketplace's `plugins` folder, registered as the `localix` marketplace on first start: they install and update like any plugin, with no special origin. |
| Surfaces      | `/rpc/plugins` (with `/rpc/plugins/updates`), the Store (Plugins), `/plugin`.                                                                                        |
| Agent         | Skills, commands and agents, namespaced `/<plugin>:<name>` as in Claude Code.                                                                                        |

A part Claude Code defines and Localix does not run is reported in the plugin's validation, never
dropped silently. A key Claude Code does not define is a validation warning, as in Claude Code.

A Localix plugin is still only a plugin. The authoring plugin of the
[Localix marketplace](https://github.com/rsaryev/localix-marketplace) is where mini apps are made:
its skills, reviewer agent, edit hook and `mini-app` command scaffold, check, build, pack and
install them, and it imports no Localix code, so X1 and X2 hold: no code path joins the two layers,
and its folder holds no `mini-app.json`. It reaches Localix only through data — the mini app kit
each release publishes, whose `tools/authoring.mjs` carries Localix's own validation
(`features/mini-apps/kit-tools.ts`), the version and contract digest `GET /health` reports, and
`POST /rpc/mini-apps/install-local` — so it lives and changes outside this repository. The app does
not carry the kit: a mini app installs the release's kit it is built against. The core keeps no
authoring: no build tool for the agent and no `/mini-app create` (X3: creating is the plugin's
command, not a `/mini-app` subcommand).

### The mini app contract

What a mini app may rely on is one committed text,
[`packages/mini-app-sdk/mini-app.api.md`](../../packages/mini-app-sdk/mini-app.api.md), as VS Code
keeps its extension API in one declaration file. It is read out of the staged kit
(`scripts/mini-app-contract.mjs`): every Localix module a mini app may import with each export's
declaration, the Localix types those declarations name, the third-party packages the host lends and
their versions, and the modules the host serves at runtime. The kit carries the same text as
`API.md` and its digest in `kit.json`; the API reports the committed one's digest
(`apps/api/src/lib/mini-app-contract.ts`) in `GET /health`, so the authoring plugin tells whether a
mini app's kit is exactly the running Localix's.

`bun run check:mini-app-contract` stages the kit and compares. A contract that moved fails until
`--write` records it, and a move that breaks a mini app built against the committed one — a module,
export, served name or lent package taken away, a lent package's major version, a property removed
or made required, an argument a function now requires, a module served for the first time — is
refused, written or not, until `MINI_APP_API_VERSION` moves too. Every CI run checks it; a release
checks the kit it is about to publish against it, then checks the Localix marketplace's mini apps
against that kit, and publishes neither on a failure. The marketplace checks its mini apps against
the kit of `main` every night.

A mod must get what Claude Code gives it. `scripts/cc-parity/` runs one probe mod in the installed
Claude Code and in Localix's mods host and compares the shapes each hands it, per event and `$`
call; `parity.test.ts` holds the entries known to match. See its
[README](../../scripts/cc-parity/README.md) for the rules and for updating after a release.

## Mini apps

### Format

```text
weather/
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
  reads one with `MiniAppGuide` before it first uses the app (as it reads a skill). It replaces the
  skills a mini app used to carry.
- A **command** is declared in `mini-app.json`: its `prompt` (with `${name}` for each argument),
  `description`, `args` with chips and pickers, `featured`, and the tools it switches on
  (`activateTools`). It runs as `/<app>:<command>`.
- A tool's description says what the tool does; `guide.md` says when to use it.

### Runtime

| Part     | Where                                                                                                                                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK      | `packages/mini-app-sdk` (`@localixai/mini-app-sdk`): manifest, backend and UI contracts. The host serves its modules.                                                                                                   |
| Runtime  | `apps/api/src/features/mini-apps/`: catalog, install and update, backend host, UI artifacts, views, the kit.                                                                                                            |
| Backend  | `register(ctx)` is the one entry. It runs once per scope (user, project, working directory) for a turn's tools and hooks, again when the backend is rebuilt or its settings change, and once more for the backend host. |
| Disk     | `~/.localix/mini-apps/<name>/` (the installed build) and `~/.localix/mini-apps-data/<name>/` (its state).                                                                                                               |
| Surfaces | `/rpc/mini-apps`, the Store (Mini apps), `/mini-app`.                                                                                                                                                                   |
| Agent    | Backend tools, `guide.md`, commands.                                                                                                                                                                                    |

### State and events

Mini apps follow the [architecture](architecture/README.md) like any owned model (P5, P7, P11):

- `features/mini-apps` is the one owner of the `mini-app` entity, `{ id: <name>, scope }`. Every
  install, update, removal and settings change records that notice; whether one may run is a
  `capability.rule` notice (`mini-app:<name>`).
- The relay turns a `mini-app` notice into the `mini-apps` client resource and moves the capability
  revision. Every surface (the rail, the Store (Mini apps), the catalog) re-reads the list from the
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

A catalog is a `mini-app-catalog.json` index of archives. Localix hosts none: the Localix
marketplace publishes its own with each of its releases (`releaseMiniAppCatalog`,
`releases/latest/download/mini-app-catalog.json`), and any author can publish theirs. Each entry
names its publisher and whether it is **verified**, which only a source Localix vouches for can say:

```json
{
  "schema": 1,
  "apps": [
    {
      "name": "weather",
      "displayName": "Weather",
      "version": "0.3.0",
      "apiVersion": 1,
      "category": "utilities",
      "description": "Forecasts and alerts.",
      "publisher": { "name": "Localix", "verified": true },
      "archive": { "url": "weather-0.3.0-3fa1c2d4e5b6.tar.gz", "bytes": 182340, "sha256": "…" }
    }
  ]
}
```

| Source               | What it is                                                                     | Updates                   |
| -------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| HTTPS catalog        | `mini-app-catalog.json` and archives; the Localix marketplace's is the default | by version, automatically |
| Git repository       | its release assets, read as an HTTPS catalog                                   | by version, automatically |
| Local catalog folder | `mini-app-catalog.json` and archives on disk, read as `file://`                | by version, automatically |
| Local package        | one built package, installed by the authoring plugin (`install-local`)         | by installing it again    |

The core builds no mini app: every catalog ships built archives, and a local package is built by the
authoring plugin before it is installed.

### Releasing, installing, updating

1. **Release.** The author raises `version`; packing (the authoring plugin's `mini-app pack`, or a
   release workflow) builds the archive and writes its catalog entry. The same version with other
   content is refused by its sha256.
2. **Choose.** The [Store](store.md) is its own workspace tab, opened on its Mini apps shelf from
   the rail's add button, from setup and from the Store (Mini apps). The mini apps provider
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
   version with a compatible `apiVersion` is installed for every app a signed catalog put there,
   unless the person switched its auto-update off (`auto-update.ts`, a `mini-app.updates` notice);
   an incompatible one says Localix needs updating. An app from an unsigned catalog is offered its
   update and takes it on the person's Update. A failed download or archive leaves the previous
   build. An update never touches the app's data folder. A catalog is **signed** when
   `<catalog>.sig` holds for the key Localix keeps for it (`catalog-signature.ts`): pinned in code
   for the Localix marketplace (`LOCALIX_MARKETPLACE.catalogKey`), kept from the first signed read
   for one the person added (`catalogs.ts`). A catalog signed with another key, or no longer signed,
   is a **mismatch**: nothing installs or updates from it until the person removes it and adds it
   again.
5. **Trust.** Installing from the store is the person's yes to run the app. An unverified publisher
   is named in the row, and its install asks again first.
6. **Create.** The authoring plugin forks its own template into a folder of the person's, builds the
   package, and `POST /rpc/mini-apps/install-local` validates it and copies it into
   `~/.localix/mini-apps/<name>/` with a local install record: the person's own app, updated by no
   catalog and never installed over a catalog's app.

## Migration

None: mini apps start clean. Their settings, secrets and data live under `mini-app-option.`,
`mini-app:` rules and `mini-apps-data/`.

## Status

| Phase | Change                                                                                                           | State     |
| ----- | ---------------------------------------------------------------------------------------------------------------- | --------- |
| 0     | This contract; Workflows removed.                                                                                | Done      |
| 1     | `mini-app.json` and `guide.md`; the first-party mini apps converted; no `.claude-plugin/` in a mini app.         | Done      |
| 2     | `features/mini-apps` split from `features/plugins`; the composed manifest and legacy layout removed.             | Done      |
| 3     | Separate storage, records, routes, settings and model-facing names; the start-up migration.                      | Done      |
| 4     | Release archives, `mini-app-catalog.json`, the install and update queue, the picker.                             | Done      |
| 5     | Localix's own mini apps and plugins leave for the Localix marketplace; the core ships none and hosts no catalog. | Docs done |
