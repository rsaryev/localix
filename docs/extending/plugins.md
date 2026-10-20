# Build a plugin

Plugins package tools, procedures, commands, agents, services and UI with their own configuration.

**Trust boundary:** Installed plugins start disabled; agent-built plugins start enabled. Native
entrypoints run as trusted code in the API process.

![The workspace tool catalog with built-in workbenches and plugin management](../assets/screenshots/plugins/workbenches--2026-10-09.png)

## What you can do

| Capability                      | Mechanism                                                                                      | Boundary                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Have the agent build one        | Run `/plugin create <what it should do>`; see [Build with the agent](build-with-the-agent.md). | The new plugin is enabled at once and runs unsandboxed.                                |
| Add model-facing tools          | Export tools from a native `register(ctx)` entrypoint.                                         | Native code runs in process and is not sandboxed.                                      |
| Package procedures and commands | Ship `SKILL.md` directories or namespaced slash-command prompts.                               | Skills and commands remain distinct invocation surfaces.                               |
| Connect external tools          | Declare MCP servers in the manifest or `.mcp.json`.                                            | The plugin enable state gates each server.                                             |
| Shape runtime behavior          | Return lifecycle hooks, a channel, or one memory provider from `register`.                     | Hook timeouts and optional host services limit these contributions.                    |
| Register native agents          | Declare typed `contributions` in the manifest.                                                 | Source availability, agent availability, invocation policy and review remain separate. |
| Add portable UI                 | Declare sandboxed HTML views; each opens as a work-item tab.                                   | A sandboxed view cannot use the host kit or native React registrations.                |
| Add a native workbench          | Ship `ui/register.tsx`; the app builds the artifact and swaps it in place.                     | Bundled plugins, and your own under `~/.localix/plugins` once you enable them.         |

## How it works

### Terms

| Term              | Meaning                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| Plugin            | A discovered directory containing a manifest or recognized component.       |
| Native entrypoint | A JavaScript or TypeScript module loaded into the API process.              |
| Contribution      | A tool, skill, command, agent, hook, server, service, or UI surface.        |
| Workbench         | A plugin-owned workspace surface backed by its own UI and optional backend. |
| Bundled plugin    | A first-party artifact synchronized from the packaged plugin set.           |
| Installed plugin  | A user-supplied artifact under a project or personal plugin root.           |

### Choose the smallest extension

| Need                                         | Owning guide                                    |
| -------------------------------------------- | ----------------------------------------------- |
| One reusable procedure                       | [Author a skill](skills-authoring.md)           |
| One external tool server                     | [Connect MCP](../features/mcp.md)               |
| A model connection                           | [Configure providers](../features/providers.md) |
| A command the agent composes calls to        | A `bin/` executable — see below                 |
| Tools plus settings, lifecycle, roles, or UI | This plugin guide                               |

For workspace UI, `/plugin create <what it should do>` has the agent name a new plugin, fork the
System Overview reference template into `~/.localix/plugins/<name>` and build it out. The
[workbench UI guide](plugin-ui.md) explains the path. For examples without a workbench UI, use
`plugins/deliverable/` or `plugins/webhook-notifier/`.

A minimal standalone backend plugin needs two files:

```text
my-plugin/
  plugin.json
  tools/
    index.mjs
```

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Adds a greeting tool.",
  "tools": "./tools/index.mjs"
}
```

```js
export function register({ z, defineTool }) {
  return {
    tools: [
      defineTool({
        name: 'greet',
        activeVerb: 'Greeting',
        description: 'Greet someone by name.',
        inputSchema: z.object({ name: z.string() }),
        async execute(_toolCallId, input) {
          return { content: `Hello, ${input.name}.` }
        },
      }),
    ],
  }
}
```

Runtime values come from `ctx`. An installed plugin has no repository dependency tree, so use
relative modules and built-in modules only, or pre-bundle external dependencies.

### Scope and enablement

| Session scope | User plugin root                     | Additional plugins                                |
| ------------- | ------------------------------------ | ------------------------------------------------- |
| Project       | `<project>/.localix/plugins/<name>/` | Bundled plugins projected into that project scope |
| No project    | `~/.localix/plugins/<name>/`         | Bundled plugins in the personal scope             |

A project session sees your personal plugins as well as its own, the project's copy winning a name
collision. Enable state and config stay keyed to the project the plugin is used in. Use Settings →
Capabilities → Plugins to install, configure, validate, and enable a plugin; after copying a
directory into a root, run `/plugin reload` or start a new runtime load.

### Native module contract

`register(ctx)` may return these contributions:

| Return field | Effect                                                              | Boundary                                                             |
| ------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `tools`      | Adds validated model-facing tools.                                  | Tool names cannot shadow built-ins.                                  |
| `hooks`      | Observes or transforms supported message and tool lifecycle points. | Each invocation is isolated and capped at five seconds.              |
| `backend`    | Adds route, resource, search, context, or live-frame subsystems.    | Optional boot-time host services may be absent during per-run loads. |
| `channels`   | Starts long-running messaging bridges.                              | Channels come from native code, not a top-level manifest field.      |
| `memory`     | Adds one external memory provider.                                  | The first enabled provider wins; output and waits are capped.        |

Import SDK contracts with `import type` from `@localixai/plugin-sdk/backend`; runtime values (`z`,
`defineTool`, config, helpers, paths, logging, UI intents, OAuth) come from `ctx`; `hono`, `zod` and
the SDK are the host's instances. The host calls `register(ctx)` more than once and reuses the
module: keep what a person creates under `ctx.dataDir`
([one chat's data](plugin-ui.md#a-tab-that-belongs-to-one-chat) under `ctx.sessionStorage`), a warm
service at module scope. `execute` takes the call id, then input.

[Hooks and commands](../features/hooks-and-commands.md) owns hook timing and command behavior;
[the SDK](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/) owns the types.

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
`details`, the transcript draws it as a button; under `details.reveal`, beside other data, the
plugin's own tool card decides how to show it. Either way the host appends `App view: <uri>` to the
model's result unless the content already names the URI. A plugin never opens a view itself; the
agent gives the person that `localix://` link, and the person opens it.

### Identity the host binds

A plugin that records who acted, or streams someone's own data, must not read that identity from
model or client input. The host binds it; the [Kanban board](../features/task-board.md) uses all
three:

| Seam                                                                                                                                                         | Answer                                                                                            | Boundary                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`ctx.agents.list(userId, sessionId)`](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/backend/context.ts)                              | The enabled agents of the session's scope, its project's included: `{ id, handle, description? }` | Read-only; rejects a session the user does not own. Store `id`. |
| [`context.session.speaker`](https://github.com/rsaryev/localix/blob/main/packages/agent/src/agents/types.ts) in `execute`                                    | `{ agentId, handle }` of the agent whose turn it is                                               | Absent when the run has no addressable speaker.                 |
| [`start(params, send, { userId })`](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/backend/ws-frame-registry.ts) on a `wsFrames` entry | The host-supplied Localix user ID of the socket                                                   | Tags `s`, `r` and `n` are core's; registration rejects them.    |

### Watching files

A backend that reacts to files changing — logs it tails, a folder another program writes — uses
`ctx.watchPath(path, recursive, onEvent, onError)`, never `node:fs.watch`: Bun's recursive
`fs.watch` on macOS delivers only part of a burst. The host's watcher (FSEvents, inotify,
ReadDirectoryChangesW) reports every change and calls `onError` when events may have been lost;
re-read once there. A file path is watched by its own name. It exists on the boot-time load only, so
a backend singleton keeps the one it was given, with a slow backstop poll for loads without it. To
push a change to an open view, use [a live stream](plugin-ui.md#a-live-stream-of-your-own).

### Search by meaning and follow your own changes

A backend can index its own items by meaning and compare texts with `ctx.host.semantic`, ask a
decision model typed questions with `ctx.host.decisions`, and record and read its own change notices
with `ctx.host.changes`. See [Semantic index and change feed](plugin-semantics.md).

### Bundled executables on PATH

An enabled plugin's `bin/` directory is prepended to the PATH of the commands the agent runs:
`bash`, and the checks and watches a [monitor](../features/monitors.md) runs. A bundled executable
therefore resolves by bare name, with no manifest field and no SDK surface. This is the smallest way
to let the agent reach a system your plugin already knows how to talk to — an SSH-tunnelled
database, a client-certificate API, a service whose pagination or terminal states are easy to get
wrong. The plugin owns the connection, the credentials and the correct query; the agent keeps
composing the command and the condition itself, which a fixed tool schema cannot do:

```text
monitor(until: { check: 'my-plugin-query --connection prod --sql "select count(*) from members"',
                 when: { number: { gte: 100 } }, every_seconds: 60 })
```

**Boundary:** only enabled plugins contribute `bin/`, the file must be executable, and only shell
callers resolve it. A wait that needs a credential refreshed DURING the watch, or a push source with
no command-line client, belongs to the plugin's own tools. A manifest `monitors` entry is a watch
the user installed, not an agent wait
([compared](../features/monitors.md#plugin-monitors-are-not-agent-waits)).

### UI paths

| UI path             | Authoring form                                                     | Availability                     |
| ------------------- | ------------------------------------------------------------------ | -------------------------------- |
| Sandboxed view      | `views` entry pointing to an HTML file                             | Installed and bundled plugins    |
| Native workbench UI | `ui/register.tsx`, built into an artifact ([guide](plugin-ui.md))  | Bundled, or enabled by the user  |
| Keyboard ownership  | `@localixai/plugin-sdk/ui/focus` claims the keyboard for a surface | Host and plugins share one stack |

A sandboxed HTML view opens as a work-item tab from its rail button or the command palette. It uses
`acquireLocalixApi()` for theme events, its owning chat, scratch state, context publication, and
same-plugin backend actions. See [Build a sandboxed HTML view](sandboxed-views.md) for the bridge
example, scope rules, CSP, and request/state limits. Native workbench UI uses its own SDK path.

## Configuration

### Full manifest reference

All paths below are relative to the plugin directory and confined to it.

| Field              | Accepted shape and default                                          | Effect                                                                      | Boundary                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`             | string, required                                                    | Stable id; letters, digits, dashes, and underscores are accepted.           | Keep it equal to the directory name.                                                                                                                              |
| `version`          | string; `0.0.0`                                                     | Version shown in Settings.                                                  | No semver enforcement.                                                                                                                                            |
| `apiVersion`       | positive integer, optional                                          | Targets the plugin contract; current version is `1`.                        | A newer version blocks loading; omission warns.                                                                                                                   |
| `description`      | string; empty                                                       | Explains the plugin in Settings and runtime context.                        | Display and model context only.                                                                                                                                   |
| `displayName`      | string; `name`                                                      | Human-readable Settings label.                                              | Display metadata only.                                                                                                                                            |
| `category`         | `development`, `data`, `content`, `utilities`, or `games`; optional | Groups workbench views in the Plugins launcher.                             | One primary category per plugin; older manifests appear under Other.                                                                                              |
| `author`           | string or `{ name?, email?, url? }`                                 | Records authorship as one display string.                                   | Informational only.                                                                                                                                               |
| `homepage`         | string, optional                                                    | Records a project page.                                                     | URL format is not validated.                                                                                                                                      |
| `repository`       | string, optional                                                    | Records the source repository.                                              | Informational only.                                                                                                                                               |
| `license`          | string, optional                                                    | Records an SPDX identifier.                                                 | Informational only.                                                                                                                                               |
| `keywords`         | string array, optional                                              | Records discovery tags.                                                     | Informational only.                                                                                                                                               |
| `migratedFrom`     | string, optional                                                    | Records migration provenance.                                               | Informational only.                                                                                                                                               |
| `origin`           | `{ format: 'claude-code', source?, version?, importedAt? }`         | Records that the importer converted this plugin.                            | Written by the Claude Code importer; Settings shows the plugin as imported.                                                                                       |
| `defaultDirs`      | `{ commands?: boolean, agents?: boolean }`; both `true`             | `false` stops scanning the default `commands/` or `agents/` directory.      | The importer sets `false` when a Claude Code manifest lists paths, which keeps its replace rule.                                                                  |
| `surfaces`         | string array; `['agent']`                                           | Declares where the plugin runs; `agent` and `workbench` are current values. | Values are normalized and unknown values are retained.                                                                                                            |
| `defaultEnabled`   | boolean, optional                                                   | Chooses the initial state for bundled plugins.                              | Ignored for installed plugins, which always wait to be allowed; bundled code-free plugins start on and bundled native-entrypoint plugins wait when it is omitted. |
| `tools`            | string or string array                                              | Selects native entrypoints.                                                 | If omitted, the first supported file under `tools/` or at `tools.*` is used.                                                                                      |
| `skills`           | string or string array                                              | Adds skill roots.                                                           | The default `skills/` root and a root `SKILL.md` are also scanned.                                                                                                |
| `commands`         | array of command objects or Markdown paths                          | Adds `/<plugin>:<name>` commands.                                           | The default `commands/` directory is also scanned unless `defaultDirs.commands` is `false`.                                                                       |
| `contributions`    | typed declaration array; max 1,000                                  | Registers native values through host-owned schemas.                         | Installed through the contribution registry; unknown kinds fail closed.                                                                                           |
| `agents`           | legacy role objects or Markdown paths; max 8                        | Retains external/legacy declarations during the transition.                 | Conversion to native registered agents is not yet complete.                                                                                                       |
| `mcpServers`       | server map, path, or path array                                     | Loads inline or file-based MCP server declarations.                         | If omitted, `.mcp.json` is read when present.                                                                                                                     |
| `hooks`            | path, path array, or inline object                                  | Loads declarative lifecycle hooks.                                          | If omitted, `hooks/hooks.json` is read when present.                                                                                                              |
| `lspServers`       | path, path array, or inline map                                     | Registers language servers from an `.lsp.json` shape.                       | Executables must resolve on the runtime PATH.                                                                                                                     |
| `promptSections`   | section array; max 3                                                | Injects static text under the plugin prompt section.                        | Each body is capped at 2,000 characters.                                                                                                                          |
| `views`            | view array; max 6                                                   | Adds sandboxed iframe UI, each opening as a work-item tab.                  | HTML stays inside the plugin and is capped at 1.5 MiB; unknown icons fall back to a generic icon. Legacy `panels` is read as `views`.                             |
| `monitors`         | monitor array; max 16                                               | Starts `always` background commands for enabled plugins.                    | Lines wake only sessions armed with `ctx.host.monitors.arm`. `on-skill-invoke:<name>` lazy start is not implemented. Unrelated to the agent's `monitor` tool.     |
| `dependencies`     | array of names or `{ name, version? }`                              | Resolves dependencies during marketplace install and cascades enable state. | Version ranges warn only; non-marketplace installs do not fetch dependencies.                                                                                     |
| `config`           | config-option map                                                   | Declares scalar settings delivered through `ctx.config`.                    | Secret values are masked from list responses, not moved into the central vault.                                                                                   |
| `fileAssociations` | association array                                                   | Projects supported file types into desktop packaging.                       | Only bundled declarations can change an installed operating-system handler list.                                                                                  |

Unknown top-level fields are stripped from the runtime manifest. `/plugin validate --strict`
promotes compatibility and hygiene warnings to errors for review.

### Config options

| Field         | Type and default                                                | Effect                                      | Boundary                                                                |
| ------------- | --------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| `type`        | `string`, `number`, `boolean`, `directory`, or `file`; `string` | Selects the editor and scalar type.         | `directory` and `file` still store strings.                             |
| `description` | string; empty                                                   | Explains the field.                         | Empty text produces a warning.                                          |
| `required`    | boolean; `false`                                                | Warns when no effective value exists.       | A missing value does not itself block plugin loading.                   |
| `secret`      | boolean; `false`                                                | Masks the value in API responses.           | Native code receives the value; avoid defaults for secrets.             |
| `default`     | string, number, or boolean                                      | Supplies an initial effective value.        | Match the declared type yourself.                                       |
| `title`       | string, optional                                                | Supplies a human-readable label.            | Rendering hint.                                                         |
| `multiple`    | boolean, optional                                               | Marks a field as accepting multiple values. | Hint only; storage remains scalar.                                      |
| `min`, `max`  | number, optional                                                | Supplies numeric bounds.                    | Hints; the manifest schema does not enforce stored values against them. |

### Inline commands

| Field                             | Effect                                                           | Boundary                                                                 |
| --------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `name`                            | Names the command; colon-separated nested segments are accepted. | The invoked name is prefixed with the plugin name.                       |
| `description`                     | Explains the command in the composer.                            | Defaults to empty.                                                       |
| `prompt`                          | Provides the agent-macro template.                               | Required.                                                                |
| `args`                            | Declares positional `text` or `choice` arguments.                | Defaults to an empty array.                                              |
| `argumentHint`                    | Adds composer placeholder text.                                  | Display only.                                                            |
| `model`                           | Requests a model for this command run.                           | Best effort; the id must resolve through configured model connections.   |
| `allowedTools`, `disallowedTools` | Auto-approves or removes tools for the command run.              | Uses engine tool names after compatibility normalization.                |
| `disableModelInvocation`          | Records a user-only command policy.                              | Plugin commands are not model-listed today, so the flag changes nothing. |

Each arg accepts `name`, `type`, `description`, `placeholder`, `required`, static `options`, an
`optionsScript`, and an optional `{ arg, equals }` condition. Use either static `options` or
`optionsScript` for one arg. See
[command authoring](../features/hooks-and-commands.md#plugin-command-example-and-options) for
parsing, preprocessing, the example manifest fragment, and dynamic-script trust boundaries.

### Native agent contributions

An installed plugin can register native agents through `contributions`. Each entry has a kind, a
source-local key, and a value validated by that kind's owning subsystem. For example:

| Entry field             | Example                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `kind`                  | `"agent"`                                                     |
| `key`                   | `"reviewer"`                                                  |
| `value.definition`      | `{ "handle": "reviewer", "instructions": "Review changes." }` |
| `value.policyProposals` | `[]`                                                          |

The registry issues the agent ID. Updating the same key preserves its ID; removing and later
reintroducing the key issues a new one. Nonempty policy proposals require explicit review in
Capabilities and grant no permissions merely by being installed. Native definitions reject tool
allowlists and foreign fields. The host registers only the `agent` kind. An unknown kind or invalid
value rejects the installation, dependency contributions included; source metadata and contributions
commit with it. Files dropped into a directory register nothing, so use the install operation.

### Declarative contribution objects

| Field                | Object shape                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `promptSections[]`   | `{ title, content }`; title max 80 characters, content max 2,000.                                                  |
| `views[]`            | `{ id, title, file, icon?, agentDescription? }`; title max 40 characters.                                          |
| `monitors[]`         | `{ name, command, description?, when? }`; `when` defaults to `always`.                                             |
| `fileAssociations[]` | `{ ext: string[], name, description?, mimeType?, role?, rank? }`; extensions are normalized without a leading dot. |

File-association `role` accepts `Editor`, `Viewer`, `Shell`, or `None`. `rank` accepts `Owner`,
`Default`, `Alternate`, or `None`.

### Test and package

For a repository plugin, run focused tests first (`bun test ./path/to/my-plugin`), then the plugin
gates: `bun run test:dropins`, `bun run type-check` and `bun run lint`. For a standalone plugin,
provide its own tests and type-check configuration. If it needs package dependencies, bundle the
native entrypoint and point `tools` at the generated self-contained file.

## Bundled plugins

Each row is a `plugin.json`: `surfaces` decides whether it adds a visible workbench or only agent
capability, and `defaultEnabled` whether it starts on. Native code in a bundled plugin still runs in
the trusted API process; review it as you would any dependency. Fifteen workbenches complement the
four [games](../features/games.md):

| Plugin              | Guide                                           | What the workbench shows                                                              |
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

Three add agent capability with no workbench of their own:

| Plugin               | Guide                              | What it adds                                                                |
| -------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| **Code Review**      | this guide                         | A scoped diff review that files prioritized inline suggestions              |
| **Deliverables**     | this guide                         | Files named in a final response become inline media or downloads            |
| **Webhook Notifier** | [Webhooks](../features/webhook.md) | Sends selected lifecycle events to a webhook, optionally HMAC-SHA256 signed |

## Limits

- Native tools, hooks, channels, monitors, and backends run as trusted local code; allowing a plugin
  is consent, not isolation. One you installed awaits your yes with its code not imported, and the
  agent can offer the approval through `configure`. Its tools stay unknown until then.
- A `secret: true` config value is masked in API responses but stored with plugin state and supplied
  to trusted native code. Use the optional vault host service when a bundled backend needs vault
  semantics.
- File associations from installed plugins are inert: desktop handlers are fixed at bundle build.
- Compatibility covers a supported subset: fields such as role isolation are recorded, not applied.
- An installed native entrypoint cannot assume repository packages are available at runtime.
- Enabling a dependency never auto-enables a non-bundled dependency that contains native code.

## Related guides

- [Build workbench UI](plugin-ui.md)
- [Install Claude Code plugins](claude-code-plugins.md)
- [Connect MCP](../features/mcp.md)

## Source of truth

- [Plugin manifest schema](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/contracts.ts)
- [Discovery and exact-scope rules](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/discovery.ts)
- [Entrypoint resolution](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/discovery-entrypoints.ts)
- [Enable policy](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/enable.ts)
- [Runtime loader](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/loader.ts)
- [Claude Code importer](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/import-claude-code.ts)
- [Backend context and services](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/backend/context.ts)
