# Build a plugin or a mini app

A Localix extension has two layers: a **plugin** in the Claude Code format, which gives the agent
skills, commands, agents, hooks and servers, and a **mini app** around it, which gives the person
screens, a backend and agent tools over Localix's own APIs. Use this page to choose the layer you
need, write its manifest, and see what the host gives a mini app.

**Trust boundary:** Installed extensions start disabled; agent-built ones start enabled. A mini
app's native backend runs as trusted code in the API process.

![The workspace tool catalog with built-in workbenches and plugin management](../assets/screenshots/plugins/workbenches--2026-10-09.png)

## Terminology

| Term              | Meaning                                                                                 | Boundary                                                             |
| ----------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Plugin            | A folder in the Claude Code plugin format, `.claude-plugin/plugin.json` and components. | Knows nothing of Localix; the same folder loads in Claude Code.      |
| Mini app          | `.localix-app/app.json` beside a plugin: backend, screens, views, settings, pickers.    | Localix only. It shares its plugin's name and names that plugin.     |
| Native backend    | A JavaScript or TypeScript module whose `register(ctx)` the API process loads.          | Declared by a mini app's `backend`; not sandboxed.                   |
| Workbench         | A mini app's screen in the workspace, built from `ui/register.tsx`.                     | Opens as a tab; a rail screen can also become a Mac app.             |
| Legacy manifest   | One root `plugin.json` that carries both layers, written before the split.              | Still loads; new extensions use the two manifests.                   |
| Bundled extension | A first-party extension synchronized from the packaged set.                             | Installed ones live under a project or personal plugin root instead. |

## What you can do

| Capability                   | Mechanism                                                                                      | Boundary                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Have the agent build one     | Run `/plugin create <what it should do>`; see [Build with the agent](build-with-the-agent.md). | The new mini app is enabled at once and runs unsandboxed.                         |
| Install a Claude Code plugin | `/plugin install` it; Localix reads it in place ([guide](claude-code-plugins.md)).             | Claude Code marketplaces are refused; install their plugins one by one.           |
| Package procedures, commands | Ship `skills/<name>/SKILL.md` and `commands/<name>.md` in the plugin.                          | Skills and commands remain distinct invocation surfaces.                          |
| Connect external tools       | Declare MCP servers in `.mcp.json` or the plugin's `mcpServers`.                               | The plugin's enable state gates each server.                                      |
| Add tools over Localix APIs  | A mini app's `backend` exports `register(ctx)` returning `tools`.                              | Native code runs in process and is not sandboxed.                                 |
| Shape runtime behavior       | Return lifecycle hooks, a channel, or one memory provider from `register`.                     | Hook timeouts and optional host services limit these contributions.               |
| Register native agents       | Declare typed `contributions` in the mini app.                                                 | Availability, invocation policy and review remain separate.                       |
| Add a native workbench       | Ship `ui/register.tsx`; the app builds the artifact and swaps it in place.                     | Bundled extensions, and your own under `~/.localix/plugins` once you enable them. |
| Add portable UI              | Declare sandboxed HTML `views`; each opens as a work-item tab.                                 | A sandboxed view cannot use the host kit or native React registrations.           |
| Run as its own Mac app       | The person installs the mini app as an app; see [Plugin apps](../features/plugin-apps.md).     | macOS only; the mini app needs a rail viewlet, its main screen.                   |

## What you can build

A mini app can be anything from a calorie counter to a database client, and it is part of Localix
from its first build. Every chat already has an agent that reads files and images, so a mini app
keeps state, shows it and gives that agent tools; it needs no model, upload pipeline or OCR of its
own. A calorie counter is a `log_meal` tool and a screen: you send a meal photo, the agent reads it
with a model that accepts images and calls the tool. The bundled DevOps, Database, Trading and
Kanban workbenches and the games are mini apps on the same contract, and the larger ones run to tens
of thousands of lines.

| What a mini app uses             | Through                                                                                    | Guide                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| The chat agent                   | `tools` from `register(ctx)` register with the agent; no glue code                         | [Native module contract](#native-module-contract)              |
| A turn started by the app        | `ctx.host.wake` with a message and the app's own tools                                     | [Wakes](plugin-wakes.md)                                       |
| Decision models                  | `ctx.host.decisions.decide`: typed `choice` and `bool` questions, spend recorded per chat  | [Semantics](plugin-semantics.md#ask-a-decision-model)          |
| Embeddings and semantic search   | `ctx.host.semantic`: index its own items, `query` by meaning, `rank` or `embed` texts      | [Semantics](plugin-semantics.md)                               |
| Suggestions in its own fields    | `textInputCompletionSurfaces` and `useMiniAppTextInputCompletion`                          | [Workbench UI](plugin-ui.md#what-you-can-do)                   |
| Vault secrets                    | `ctx.host.resolveSecret`, `storeSecret` (a free key only) and `bindSecret`                 | [Vault](../features/secrets.md)                                |
| Storage per chat and per project | `ctx.dataDir`, `ctx.sessionStorage`, `ctx.host.workspaceScope` and `workspaces`            | [One chat's data](plugin-ui.md#a-tab-that-belongs-to-one-chat) |
| Change feeds and live push       | `ctx.host.changes`, the store feed, `wsFrames` streams on Localix's one socket             | [Sync](plugin-sync.md)                                         |
| Context for the agent            | `resourceProvider`, `searchProvider` and `contextProviders` from `backend`                 | [Native module contract](#native-module-contract)              |
| Chat media                       | `ctx.host.media.getBytes(id)` for an upload it was handed; `putBytes` for what it produced | —                                                              |
| Terminals and files              | `ctx.terminalRead` (read-only), `ctx.watchPath`, `host.fileEditors` for a file family      | [Watching files](#watching-files)                              |
| Routes and screens               | `routeMount` with `routeValidator`; `ui/register.tsx` built against the host's kit         | [Routes](plugin-routes.md), [UI](plugin-ui.md)                 |
| Its own Mac app                  | **Install _Name_ as App** from its tab, rail button or the command palette                 | [Plugin apps](../features/plugin-apps.md)                      |

**Availability:** `ctx.host` and most of its services are optional; a per-run load can lack the
boot-time ones, so a backend checks before it calls. Decision models need a connection that serves
one; semantic search answers once its model is on this computer.

## How it works

### Two layers

A plugin is what the agent uses, in Claude Code's own format; a mini app is what the person uses.
Claude Code ignores `.localix-app/`, the backend and the UI, so copying a mini app's folder into
Claude Code installs its plugin. Localix reads both manifests and serves them as one extension under
one name. A mini app's display fields (`displayName`, `description`, …) win over its plugin's; the
plugin keeps its version. Settings → Capabilities → Plugins labels each entry **Claude Code
plugin**, **mini app** or **legacy manifest**. The
[design note](https://github.com/rsaryev/localix/blob/main/docs/internals/plugins-and-mini-apps.md)
records the rules.

One procedure is a [skill](skills-authoring.md), one tool server is [MCP](../features/mcp.md), and a
command the agent composes calls to is a `bin/` executable. Skills, commands and hooks for any agent
make a plugin; tools over Localix's APIs, settings or a screen make a mini app. For a workbench,
`/plugin create <what it should do>` has the agent fork the System Overview template into
`~/.localix/plugins/<name>` and build it out; the [workbench UI guide](plugin-ui.md) explains the
path.

### A minimal plugin

```text
calorie-log/
  .claude-plugin/plugin.json
  skills/estimate-calories/SKILL.md
```

```json
{
  "name": "calorie-log",
  "version": "0.1.0",
  "description": "Estimates the calories of a meal from a photo or a description."
}
```

The skill is an ordinary [`SKILL.md`](skills-authoring.md). The folder loads unchanged in Claude
Code, and in Localix it appears as `/calorie-log:estimate-calories`.

### A minimal mini app

Add `.localix-app/app.json` and a backend to the same folder:

```json
{ "name": "calorie-log", "apiVersion": 1, "category": "utilities", "backend": "./backend/index.ts" }
```

```ts
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'

export function register({ z, defineTool, dataDir }: MiniAppContext) {
  return {
    tools: [
      defineTool({
        name: 'log_meal',
        activeVerb: 'Logging a meal',
        description: 'Record a meal the person ate, with its items and estimated calories.',
        inputSchema: z.object({ items: z.array(z.string()), calories: z.number() }),
        mutates: true,
        classify: () => ({ effect: 'host' }),
        async execute(_toolCallId, input) {
          const entry = { at: new Date().toISOString(), ...input }
          await appendFile(join(dataDir, 'meals.jsonl'), `${JSON.stringify(entry)}\n`)
          return { content: `Logged ${input.calories} kcal.` }
        },
      }),
    ],
  }
}
```

`classify` tells the permission gate where the change lands (`host`: the app's own data), so a
session that refuses network effects still allows it. An installed backend has no repository
dependency tree: use relative modules and built-in modules only, or pre-bundle dependencies.

### Scope and enablement

| Session scope | User plugin root                     | Additional extensions                          |
| ------------- | ------------------------------------ | ---------------------------------------------- |
| Project       | `<project>/.localix/plugins/<name>/` | Bundled ones projected into that project scope |
| No project    | `~/.localix/plugins/<name>/`         | Bundled ones in the personal scope             |

A project session sees your personal extensions as well as its own. On a name collision your
extension wins and the project's copy is hidden, so a repository cannot run its code under a
permission you gave your own plugin. A personal extension has one configuration in every project; a
`sensitive` setting is kept in the [vault](../features/secrets.md). Use Settings → Capabilities →
Plugins to install, configure, validate, and enable one; after copying a directory into a root, run
`/plugin reload`.

### Native module contract

`register(ctx)` may return these contributions:

| Return field | Effect                                                                                    | Boundary                                                             |
| ------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `tools`      | Adds validated model-facing tools.                                                        | Tool names cannot shadow built-ins.                                  |
| `hooks`      | Observes or transforms supported message and tool lifecycle points.                       | Each invocation is isolated and capped at five seconds.              |
| `backend`    | Adds routes, resource and search providers, context providers, completions, live streams. | Optional boot-time host services may be absent during per-run loads. |
| `channels`   | Starts long-running messaging bridges.                                                    | Channels come from native code, not a manifest field.                |
| `memory`     | Adds one external memory provider.                                                        | The first enabled provider wins; output and waits are capped.        |

Import SDK contracts with `import type` from `@localixai/mini-app-sdk/backend`; runtime values (`z`,
`defineTool`, config, helpers, paths, logging, UI intents, OAuth) come from `ctx`; `hono`, `zod` and
the SDK are the host's instances. The host calls `register(ctx)` more than once and reuses the
module: keep what a person creates under `ctx.dataDir`
([one chat's data](plugin-ui.md#a-tab-that-belongs-to-one-chat) under `ctx.sessionStorage`), a warm
service at module scope. `execute` takes the call id, then input.

[Hooks and commands](../features/hooks-and-commands.md) owns hook timing and command behavior;
[the SDK](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/) owns the types.

### Results a tool reports

The transcript shows a call with `isError: true` as failed, so keep it for a call that did nothing
because the model got it wrong. The bundled game and board tools follow these rules:

| Case                                                                  | Report                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A batch whose later step is refused after earlier steps changed state | Success: what the earlier steps did, then which step was not run and why.                        |
| A step the model could not predict (a random tile, a sunk ship)       | Skip it or stop the batch there; do not fail the call.                                           |
| Control passes to someone else mid-batch (a new game the user opens)  | Stop the batch and report it as success.                                                         |
| A lookup that finds nothing (no connection configured)                | A plain answer, not an error.                                                                    |
| The same input that changes state on every call (a list of moves)     | Declare `behaviorHints: { idempotentHint: false }`; the repeat guard then also compares results. |

Without that hint, the host's repeat guard counts identical calls regardless of their results and
stops the run on the eighth in a row.

A tool that produced something to look at offers it with `ctx.ui.offer({ uri, label })`. Returned as
`details`, the transcript draws it as a button; under `details.reveal`, beside other data, the app's
own tool card decides how to show it. Either way the host appends `App view: <uri>` to the model's
result unless the content already names the URI. An app never opens a view itself; the agent gives
the person that `localix://` link, and the person opens it.

### Identity the host binds

An app that records who acted, or streams someone's own data, must not read that identity from model
or client input. The host binds it; the [Kanban board](../features/task-board.md) uses all three:

| Seam                                                                                                                                                           | Answer                                                                                            | Boundary                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`ctx.agents.list(userId, sessionId)`](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/backend/context.ts)                              | The enabled agents of the session's scope, its project's included: `{ id, handle, description? }` | Read-only; rejects a session the user does not own. Store `id`. |
| [`context.session.speaker`](https://github.com/rsaryev/localix/blob/main/packages/agent/src/agents/types.ts) in `execute`                                      | `{ agentId, handle }` of the agent whose turn it is                                               | Absent when the run has no addressable speaker.                 |
| [`start(params, send, { userId })`](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/backend/ws-frame-registry.ts) on a `wsFrames` entry | The host-supplied Localix user ID of the socket                                                   | Tags `s`, `r` and `n` are core's; registration rejects them.    |

### Watching files

A backend that reacts to files changing — logs it tails, a folder another program writes — uses
`ctx.watchPath(path, recursive, onEvent, onError)`, never `node:fs.watch`: Bun's recursive
`fs.watch` on macOS delivers only part of a burst. The host's watcher (FSEvents, inotify,
ReadDirectoryChangesW) reports every change and calls `onError` when events may have been lost;
re-read once there. It exists on the boot-time load only, so a backend singleton keeps the one it
was given, with a slow backstop poll for loads without it. To push a change to an open view, use
[a live stream](plugin-ui.md#a-live-stream-of-your-own).

### Bundled executables on PATH

An enabled plugin's `bin/` directory is prepended to the PATH of the commands the agent runs:
`bash`, and the checks and watches a [monitor](../features/monitors.md) runs. A bundled executable
resolves by bare name, with no manifest field and no SDK surface — the smallest way to let the agent
reach a system your extension already knows how to talk to. The extension owns the connection and
the correct query; the agent keeps composing the command and the condition itself:

```text
monitor(until: { check: 'my-plugin-query --connection prod --sql "select count(*) from members"',
                 when: { number: { gte: 100 } }, every_seconds: 60 })
```

**Boundary:** only enabled plugins contribute `bin/`, the file must be executable, and only shell
callers resolve it. A plugin `monitors` entry is a watch the user installed, not an agent wait
([compared](../features/monitors.md#plugin-monitors-are-not-agent-waits)).

### UI paths

| UI path             | Authoring form                                                       | Availability                        |
| ------------------- | -------------------------------------------------------------------- | ----------------------------------- |
| Sandboxed view      | A mini app `views` entry pointing to an HTML file                    | Installed and bundled mini apps     |
| Native workbench UI | `ui/register.tsx`, built into an artifact ([guide](plugin-ui.md))    | Bundled, or enabled by the user     |
| Keyboard ownership  | `@localixai/mini-app-sdk/ui/focus` claims the keyboard for a surface | Host and extensions share one stack |

A sandboxed view uses `acquireLocalixApi()` for theme events, its owning chat, scratch state,
context publication, and same-app backend actions. See
[Build a sandboxed HTML view](sandboxed-views.md) for the bridge, scope rules, CSP and limits.

## Configuration

All paths are relative to the extension folder and confined to it.

### Plugin manifest

`.claude-plugin/plugin.json` is Claude Code's manifest, read in place with Claude Code's rules:
listed `commands` and `agents` replace their default folder, `skills` add to it, and `hooks`,
`mcpServers` and `lspServers` merge with their default files. `userConfig` becomes the settings
form. [Claude Code plugins](claude-code-plugins.md) lists what Localix runs and what it reports.

### Mini app manifest

`.localix-app/app.json` (schema `miniAppManifestSchema` from
`@localixai/mini-app-sdk/app-manifest`):

| Field              | Shape                                                    | Effect and boundary                                                                               |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `name`             | string, required                                         | The plugin's name in the same folder; a different name stops loading.                             |
| `apiVersion`       | positive integer                                         | Targets the contract, currently `1`. A newer version blocks loading; omission warns.              |
| `displayName`, …   | `description`, `author`, `homepage`, `license`, …        | Display fields; they win over the plugin's. `version` applies only when the plugin has none.      |
| `category`         | `development`, `data`, `content`, `utilities` or `games` | Groups workbenches in the Plugins launcher; one per app.                                          |
| `surfaces`         | string array; `['agent']`                                | `workbench` adds a screen. Unknown values are retained.                                           |
| `defaultEnabled`   | boolean                                                  | Initial state of a bundled app. Installed ones always wait to be allowed.                         |
| `private`          | boolean                                                  | Keeps an authoring scaffold out of packaging.                                                     |
| `backend`          | string or string array                                   | The native entrypoint(s) exporting `register(ctx)`; `/plugin create` builds write it.             |
| `config`           | config-option map                                        | Settings delivered through `ctx.config`; one form with the plugin's `userConfig`, whose keys win. |
| `commands`         | map keyed by the plugin's command name                   | How Localix offers the command: `args` chips and pickers, `featured`, `activateTools` (max 8).    |
| `views`            | view array; max 6                                        | Sandboxed iframe UI, each a work-item tab; HTML capped at 1.5 MiB.                                |
| `promptSections`   | `{ title, content }` array; max 3                        | Static text under the extension's prompt section; title max 80, content max 2,000 characters.     |
| `contributions`    | typed declaration array; max 1,000                       | Native values through host-owned schemas; unknown kinds fail closed.                              |
| `fileAssociations` | association array                                        | File types projected into desktop packaging; only bundled declarations reach the OS.              |
| `dependencies`     | names or `{ name, version? }`                            | Other plugins installed and enabled with the app; version ranges warn only.                       |

The native UI is found by convention at `ui/register.tsx`. A `views[]` entry is
`{ id, title, file, icon?, agentDescription? }`; a `fileAssociations[]` entry is
`{ ext, name, description?, mimeType?, role?, rank? }` with `role` `Editor`, `Viewer`, `Shell` or
`None` and `rank` `Owner`, `Default`, `Alternate` or `None`.

### Config options

| Field         | Type and default                                                | Effect                                      | Boundary                                                    |
| ------------- | --------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| `type`        | `string`, `number`, `boolean`, `directory`, or `file`; `string` | Selects the editor and scalar type.         | `directory` and `file` still store strings.                 |
| `description` | string; empty                                                   | Explains the field.                         | Empty text produces a warning.                              |
| `required`    | boolean; `false`                                                | Warns when no effective value exists.       | A missing value does not itself block loading.              |
| `secret`      | boolean; `false`                                                | Masks the value in API responses.           | Native code receives the value; avoid defaults for secrets. |
| `default`     | string, number, or boolean                                      | Supplies an initial effective value.        | Match the declared type yourself.                           |
| `title`       | string, optional                                                | Supplies a human-readable label.            | Rendering hint.                                             |
| `multiple`    | boolean, optional                                               | Marks a field as accepting multiple values. | Hint only; storage remains scalar.                          |
| `min`, `max`  | number, optional                                                | Supplies numeric bounds.                    | Hints; stored values are not checked against them.          |

### Commands and their pickers

A command's prompt is the plugin's `commands/<name>.md`. Its `arguments` frontmatter names the
positional arguments that fill `$name`; `$ARGUMENTS` and `$1` work as in Claude Code. The mini app's
`commands.<name>.args` adds chips and pickers: `text` or `choice`, static `options` or an
`optionsScript`, and an optional `{ arg, equals }` condition. The bundled Workflows keeps its prompt
in `plugins/workflows/commands/workflows.md` and its argument chips in its `app.json`. See
[command authoring](../features/hooks-and-commands.md#plugin-command-example-and-options).

### Native agent contributions

A `contributions` entry
`{ "kind": "agent", "key": "reviewer", "value": { "definition": { "handle": "reviewer", "instructions": "Review changes." }, "policyProposals": [] } }`
registers a native agent. The registry issues its ID and keeps it while the key stays. Policy
proposals need review in Capabilities; definitions reject tool allowlists. An invalid entry rejects
the installation, and files dropped into a directory register nothing: use the install operation.

### Legacy manifest

A root `plugin.json` that carries both layers still loads, with the fields above plus `tools` for
the backend and inline `commands`. A folder that has `.claude-plugin/plugin.json` or
`.localix-app/app.json` ignores a root `plugin.json` and warns, except the one an earlier Localix
wrote beside an imported Claude Code plugin, which is skipped silently.

### Test and package

In the repository, run `bun test ./path/to/my-app`, then `bun run test`, `type-check` and `lint`. A
standalone extension brings its own tests; bundle any package dependencies into the backend and
point `backend` at that file.

## Bundled extensions

Each ships as a plugin with a mini app around it: `surfaces` decides whether it adds a workbench,
and `defaultEnabled` whether it starts on. Native code in a bundled extension still runs in the
trusted API process. Fifteen workbenches complement the four [games](../features/games.md):

| Mini app            | Guide                                           | What the workbench shows                                                              |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| **2048**            | [2048](../features/game-2048.md)                | A tile puzzle with human-play and agent-play modes                                    |
| **Snake**           | [Snake](../features/game-snake.md)              | A snake steered by the person or by a decision model                                  |
| **API Client**      | [API client](../features/api.md)                | Saved requests, environments, imports, parameters, responses, vault-backed references |
| **Code Graph**      | [Code Graph](../features/code-graph.md)         | Directories, files and symbols with imports, calls, inheritance, impact and cycles    |
| **Database**        | [Database](../features/database.md)             | Connections, schemas, SQL and non-SQL consoles, tables, diagrams, result sets         |
| **DevOps**          | [DevOps](../features/devops.md)                 | Containers, images, volumes, networks, Kubernetes workloads, logs                     |
| **Documents**       | [Documents](../features/documents.md)           | PDF, document, spreadsheet, presentation, CSV, table, and chart surfaces              |
| **Resumes**         | [Resumes](../features/resumes.md)               | Six templates, structured editing, source import, A4 preview, PDF and Word export     |
| **Git**             | [Source control](../features/source-control.md) | Changes, conflicts, history, branches, and review context                             |
| **Kanban board**    | [Kanban board](../features/task-board.md)       | One passive task board per chat: epics, tasks, dependencies, owners and blockers      |
| **Learning Studio** | [Learning loop](../features/learning-loop.md)   | File-authored courses, lessons, and durable progress                                  |
| **Project Space**   | [Project Space](../features/project-space.md)   | One board per project: notes, shapes, connectors and live references to its files     |
| **Reader**          | [Reader](../features/reader.md)                 | EPUB, PDF, MOBI/AZW3, FB2, CBZ, Markdown, HTML, and text with annotations             |
| **Trading**         | [Market research](../features/trading.md)       | Read-only public venues, charts, indicators, order books, and trades                  |
| **System Overview** | this guide                                      | OS history, process context and a reusable skill                                      |

![The System Overview workbench reading live OS metrics and recent CPU and memory samples](../assets/screenshots/system/overview--2026-10-08.png)

## Limits

- Native tools, hooks, channels, monitors, and backends run as trusted local code; allowing an
  extension is consent, not isolation. One you installed awaits your yes with its code not imported,
  and the agent can offer the approval through `configure`. Its tools stay unknown until then.
- A `secret: true` config value is masked in API responses but stored with plugin state and supplied
  to trusted native code. Use the vault host service when a backend needs vault semantics.
- File associations from installed mini apps are inert: desktop handlers are fixed at bundle build.
- An installed backend cannot assume repository packages are available at runtime.
- Enabling a dependency never auto-enables a non-bundled dependency that contains native code.

## Related guides

- [Build with the agent](build-with-the-agent.md)
- [Claude Code plugins](claude-code-plugins.md)
- [Build workbench UI](plugin-ui.md)
- [Plugin apps](../features/plugin-apps.md)
- [Connect MCP](../features/mcp.md)

## Source of truth

- [Mini app manifest schema](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/manifest/app.ts)
- [Claude Code plugin format](https://github.com/rsaryev/localix/tree/main/packages/claude-plugin/src)
- [Composing the two manifests](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/layout/compose.ts)
- [Runtime manifest schema](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/contracts.ts)
- [Discovery and exact-scope rules](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/discovery.ts)
- [Enable policy](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/enable.ts)
- [Runtime loader](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/loader.ts)
- [Backend context](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/backend/context.ts)
  and
  [host services](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/backend/host-services.ts)
