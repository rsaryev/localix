# Install Claude Code plugins

Localix reads a Claude Code plugin in place: `.claude-plugin/plugin.json` and its component folders
load as they are, with no conversion, and the same folder keeps working in Claude Code. Use this
page to install one and to see which Claude Code features run in Localix.

## What you can do

| Outcome                                  | How                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| Install a Claude Code plugin from GitHub | `/plugin install owner/repo`                                            |
| Install from a git URL or a local folder | `/plugin install https://…/repo.git` or `/plugin install /path/to/dir`  |
| Add a Claude Code marketplace            | `/plugin marketplace add owner/repo` (or a git URL, a folder, a URL)    |
| Install from a marketplace               | `/plugin install <name>@<marketplace>`                                  |
| Add a marketplace and install in one go  | `/plugin install <name> --marketplace <source>`                         |
| Install for one project only             | Add `--project`; installs default to `~/.localix/plugins` for all chats |
| Drop a folder in                         | Copy it under a plugin root and run `/plugin reload`                    |

A Claude Code marketplace is a repository, folder or hosted file whose catalog is
`.claude-plugin/marketplace.json`. `/plugin marketplace list <name>` shows its plugins,
`/plugin marketplace update <name>` refreshes it and updates what was installed from it, and
`/plugin marketplace remove <name>` removes it with the plugins installed from it.

`/plugin install` leaves a plugin whose manifest or marketplace entry sets `defaultEnabled: false`
off until you enable it, and names the dependencies it installed. `/plugin disable` refuses while
another enabled plugin depends on the one named, and `/plugin enable` or `/plugin disable` on a
plugin already in that state says so. Removing a plugin from the last place it is installed also
deletes its `${CLAUDE_PLUGIN_DATA}` folder and its vault-held settings. `/plugin validate <path>`
validates a folder that is not installed and ends with Claude Code's verdict line.

A user-scope plugin has one configuration in every project, as Claude Code's `pluginConfigs` does. A
`sensitive` userConfig value is stored in the [vault](../features/secrets.md), encrypted and bound
to the plugin; the plugin's settings keep only a reference, and the value reaches its hooks, MCP
servers and `CLAUDE_PLUGIN_OPTION_<KEY>` when they run.

To give a plugin screens, a backend or agent tools over Localix's APIs, add a mini app beside it;
see [Build a plugin or a mini app](plugins.md).

## How it works

Discovery reads the manifest and component folders with Claude Code's rules. A folder without a
manifest is a plugin named after the folder when it has a component folder such as `skills/` or
`commands/`. Settings → Capabilities → Plugins labels it **Claude Code plugin** and skips authoring
reminders such as a missing license.

| Claude Code rule                                     | In Localix                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Listed `commands` / `agents` paths                   | Replace the default `commands/` / `agents/` folder                                 |
| Listed `skills` paths                                | Add to the default `skills/` folder                                                |
| `hooks`, `mcpServers`, `lspServers`                  | Merge with `hooks/hooks.json`, `.mcp.json`, `.lsp.json`; the default file first    |
| `userConfig`, `sensitive: true`                      | The plugin's settings form, masked when sensitive                                  |
| `${VAR}` in an MCP server's config                   | Expands from the environment, as in Claude Code                                    |
| `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`     | The plugin's folder and its data folder                                            |
| `${user_config.KEY}`                                 | The setting's value                                                                |
| Command `arguments` frontmatter                      | Names positional arguments; `$name` takes each value, beside `$ARGUMENTS` and `$1` |
| Names Anthropic reserves (`claude-…`, `anthropic-…`) | Load, as Claude Code loads Anthropic's own plugins                                 |

**Boundary:** in a remote MCP server's `url` and `headers`, a variable whose name looks like a
credential (`TOKEN`, `SECRET`, `API_KEY`, `PASSWORD`, …) reads as empty unless the plugin's settings
supply it; a stdio server inherits the environment anyway.

### Hook events

Every Claude Code hook event runs at its Localix point, with Claude Code's input fields and
decisions. Where Localix's moment differs, the table says where it fires. See
[Hooks and commands](../features/hooks-and-commands.md).

| Events                                                                           | In Localix                                                                                            |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `Notification`         | As in Claude Code                                                                                     |
| `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`               | Around every tool call and after each batch of parallel calls                                         |
| `UserPromptExpansion`                                                            | A typed skill or plugin command, after `UserPromptSubmit`                                             |
| `PermissionRequest`, `PermissionDenied`                                          | The approval card, which the hook races; refusals by a mode's rules or on an unattended run           |
| `SubagentStart`, `SubagentStop`, `TeammateIdle`                                  | Delegated tasks; a conversation member that is not the leader                                         |
| `TaskCreated`, `TaskCompleted`                                                   | Cards on the task board (`kanban`)                                                                    |
| `PreCompact`, `PostCompact`, `InstructionsLoaded`                                | A context checkpoint (`trigger: auto`); context files loaded with `SessionStart`                      |
| `PreModelSwitch`, `PostModelSwitch`, `ConfigChange`, `CwdChanged`, `FileChanged` | The model picker and `/model`; an approved `configure` write; a project move; watched files           |
| `StopFailure`, `MessageDisplay`                                                  | A turn that ends on an API error; each text block of a settled reply, its `displayContent` shown only |
| `Elicitation`, `ElicitationResult`                                               | An MCP server asking for input: a card in the chat that made the call                                 |
| `WorktreeCreate`                                                                 | A workflow agent with `isolation: 'worktree'`; the hook replaces `git worktree add`                   |

Four events have no Localix moment and never fire; validation says why. `Setup` runs only for Claude
Code's `--init` and `--maintenance` flags. `DirectoryAdded` needs `/add-dir`, and a Localix session
has one folder. `WorktreeRemove` fires for worktree sessions, which Localix does not run; like
Claude Code, it keeps a workflow agent's hook-made worktree. Between-turn events (a model switch, a
project move, a file change) fire the hooks the conversation's latest turn assembled.

`transcript_path` names the conversation as a JSONL file in Claude Code's transcript format, one
`user` or `assistant` entry per line with Claude Code's tool names, so hooks such as ralph-loop and
hookify's stop rules read it as they do in Claude Code. A `SubagentStop` hook's
`agent_transcript_path` is the delegated task's own file, under `subagents/` beside it. Localix
keeps the conversation in its database and rewrites these files from it before a hook that can read
them runs; they live in the session's data folder and go with the session.

### Earlier installs

Versions before this one converted a Claude Code plugin at install and wrote a root `plugin.json`
beside it. That file is now ignored, and the `.claude-plugin/` manifest is read. Plugins installed
into the Default project's folder (`~/.localix/workspace/.localix/plugins`), which its chats never
saw, still move to `~/.localix/plugins` once at startup, with their saved state. A plugin of the
same name already there keeps both copies where they are, and the log says so.

### Marketplaces

A marketplace entry names where its plugin comes from, and Localix fetches it as Claude Code does.

| Entry source                           | In Localix                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| A relative path, `metadata.pluginRoot` | Read from the marketplace's own folder                                        |
| `github`, `url`, `git-subdir`          | Fetched with git at `sha`, `commit` or `ref`; a subdirectory checks out alone |
| `npm`                                  | Installed from the npm registry                                               |
| `archive`                              | Downloaded over https, checked against its `sha256`, unpacked                 |
| `command`                              | Not run; install from the folder the command prints                           |

An entry whose plugin has no `.claude-plugin/plugin.json` is its manifest: the official `*-lsp`
plugins get their language servers this way. Where both exist, the entry's commands, agents, skills,
output styles and themes are added and its hooks replace the manifest's per event; `strict: false`
with components in both is refused as conflicting manifests. Reserved marketplace names (Anthropic's
own, `inline`, `npm` and look-alikes) are refused unless the source is Anthropic's GitHub.

### Output styles, themes and settings

An output style shapes how agents answer. Localix offers Claude Code's Default, Proactive, Concise,
Explanatory and Learning, a plugin's `output-styles/*.md` as `<plugin>:<name>`, and your own
Markdown files in `~/.localix/output-styles/` and a project's `.localix/output-styles/` (the nearest
folder wins). Set the style every chat starts in under Settings → Preferences → Output style; use
`/output-style <name>` for one chat and `/output-style default` to turn styles off there.
`keep-coding-instructions` keeps the engineering lines of the agent's instructions, and a style
marked `force-for-plugin` applies while its plugin is enabled. Styles shape a chat's own replies,
not delegated tasks.

A plugin's themes appear in Settings → Preferences → Appearance and through `/theme <name>`, with
those of the open project's plugins. Choosing one applies its light or dark base plus its colors;
Localix falls back to the base when the plugin is disabled.

A plugin's `agents/*.md` are subagent types. Agents that can delegate see them under `# Agent types`
and hand a task to one with `delegate` and `agent: "<plugin>:<name>"`, or the bare name when only
one plugin defines it; a workflow's `agent()` takes the same `agentType`. The child runs with the
agent's prompt, `tools` and `disallowedTools`, `model` (`inherit` keeps the chat's), `effort`,
preloaded `skills` and `maxTurns`. `background: true` never waits for the report, and
`isolation: worktree` works in a fresh git worktree, which is kept. As in Claude Code, a plugin
agent's `hooks`, `mcpServers` and `permissionMode` are ignored.

A plugin's `settings.json` `agent` runs chats on the default agent as that plugin agent, on its
`model`, unless you picked the chat's model yourself. `subagentStatusLine` rewrites the rows of
running subagents in the agent sessions panel under the message box.

### Channels

A plugin MCP server that declares `claude/channel` speaks into the chat that last used it; enabling
the plugin opts it in. For a server you added, turn on **Listen as a channel** in Settings → MCP, as
Claude Code's `--channels` does. Localix remembers which chat a channel speaks into, so after a
restart its messages arrive before your next message. A channel that declares
`claude/channel/permission` receives each approval prompt opened in its chat and may answer
`yes <id>` or `no <id>`; the first answer applies to that one call.

### Workflows

`/<plugin>:<name> [input]` runs a plugin's `workflows/*.js` script in the background: the chat stays
free, the run is a background job you can stop with `jobs`, and its result arrives in a later turn.
Each `agent()` call is a child task of the chat, on the `model` and `effort` it asks for (an alias
such as `haiku` resolves to the newest model of that family on the chat's provider) and, with
`isolation: 'worktree'`, in a fresh git worktree under `~/.localix/worktrees` that is removed when
the agent changed nothing. Up to 16 agents of a run go at once, fewer on machines with fewer cores.
A token target such as "+500k" in the input becomes `budget.total`.

Each run has an id (`wf-…`) and keeps its script and journal in `~/.localix/workflow-runs/`. Run the
workflow again with `resumeFromRunId` to resume a stopped run: completed agents return their saved
results, and the first changed or failed agent and everything after it run again.

## Compatibility

Checked against the Claude Code plugins reference. A part Localix does not run is reported in the
plugin's validation, never dropped silently. In October 2026 all 328 plugins of Anthropic's
`claude-code` and `claude-plugins-official` marketplaces installed through them without an error.

| Claude Code feature                                                     | Status in Localix                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Metadata: `name`, `displayName`, `version`, `description`, `author` …   | Supported                                                                                         |
| `commands` (Markdown with frontmatter, nested folders as `dir:name`)    | Supported                                                                                         |
| `agents` (Markdown with frontmatter)                                    | Supported as subagent types `<plugin>:<name>` the agent delegates to; no limit per plugin         |
| `skills`, root `SKILL.md`                                               | Supported                                                                                         |
| `hooks`                                                                 | Supported on every event; see [Hook events](#hook-events)                                         |
| Hooks modules (`modules` in `hooks/hooks.json`, a mod)                  | Supported; see [Mods](#mods)                                                                      |
| `mcpServers`, `.mcp.json`                                               | Supported, with MCP elicitation                                                                   |
| `lspServers`, `.lsp.json`                                               | Supported over stdio; see [Language servers](../features/lsp.md)                                  |
| `userConfig` with `sensitive`                                           | Supported                                                                                         |
| `monitors`, `experimental.monitors`, `monitors/monitors.json`           | Supported; an `on-skill-invoke` monitor starts the first time its skill or command runs in a chat |
| `bin/`                                                                  | Supported: on the PATH of the agent's shell and monitors                                          |
| `dependencies`                                                          | Supported for marketplace installs                                                                |
| `outputStyles`                                                          | Supported; see [Output styles](#output-styles-themes-and-settings)                                |
| `themes`                                                                | Supported in Settings → Preferences → Appearance and `/theme`                                     |
| `workflows`                                                             | Supported; see [Workflows](#workflows)                                                            |
| Plugin `settings.json` (`agent`, `subagentStatusLine`)                  | Supported                                                                                         |
| `channels`                                                              | Supported, with permission relay                                                                  |
| Claude Code marketplaces (`.claude-plugin/marketplace.json`)            | Supported; see [Marketplaces](#marketplaces)                                                      |
| Claude Code's own installs (`installed_plugins.json`, `enabledPlugins`) | Read in place; each waits for your approval, and a Localix install of the same name wins          |

## Mods

A plugin whose `hooks/hooks.json` lists `modules` is a mod. Localix bundles the module with Bun
(TypeScript and JSX included, `h` and `Fragment` as globals) and calls its `register(on, options)`
with the plugin's `userConfig` values.

A Claude Code session runs in one directory, so a mod runs once per project: an instance starts with
`session.start` in the project's folder the first time a chat there needs it, keeps its own state,
and serves every chat in that project. One more instance runs in the workspace, so a mod's commands
and panes are there before any chat. Instances reload when the plugin is updated, enabled or
reconfigured; at most eight projects run a mod at once, and the least recently used one stops
(`session.end`).

Each instance runs in a QuickJS VM of its own, in a worker thread: the same sandbox that runs
`codemode` scripts. As Claude Code describes a hooks module, `$` is its only way out: the VM has no
`process`, `Bun`, `fetch`, `require`, environment, files or timer globals, and no code can be made
in it with `eval` or `Function`. A module that reaches for `import.meta.require` does not load, and
`import(…)` rejects.

Standard JavaScript and the web APIs `URL`, `TextEncoder`, `TextDecoder`, `Headers`,
`AbortController`, `crypto.subtle`, `crypto.getRandomValues`, `structuredClone`, `atob` and `btoa`
work; `Intl`, `Blob`, `Response` and the stream classes are not there. The built-in objects are
frozen, so a module cannot change what the runtime beside it relies on, though it can still assign
to its own objects. `console` prints text, at most 200 lines in 10 seconds.

Each instance has 128 MiB of memory: an allocation past it fails inside the mod with
`InternalError: out of memory`, and the rest of Localix goes on. A module whose `register` has not
finished within 10 seconds does not load. One that holds its thread for 10 seconds without yielding,
in a loop or a chain of promises, is interrupted and stopped, as is one that crashes; it is reported
and starts again with the next event that needs it. A second death within a minute makes it wait a
second first, and a third stops it until the plugin changes. Localix keeps answering meanwhile.

`$.clock.every` fires at most every 100 ms, and an instance has at most 100 timers and sleeps
pending.

Every `$` call answers with a promise, as in Claude Code, except the synchronous `ui.notice`,
`ui.invalidate`, `ui.resolve`, `ui.log`, `ui.toast`, `ui.status`, `clock.after` and `clock.every`.
Each call is also an event the other mods of the project can hook, and an `engine.create` step adds
nouns of its own (`$.telemetry`) to every mod's `$`.

| Part of `$`                                                                                      | In Localix                                                                                       |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `$.tool.call`, `list`, `check`, `register`; `$.mcp.call`                                         | The running turn's tools under Claude Code's names (`Bash`, `Edit`, `mcp__<server>__<tool>` …)   |
| `$.command.register`, `run`, `list`                                                              | `/<name>` or `/<plugin>:<name>` in the message box, answered by the project's instance           |
| `$.agent.spawn`, `list`, `register`                                                              | A delegated child task of the chat; `register` defines `<plugin>:<name>`                         |
| `$.model.complete`, `fork`, `classify`                                                           | One completion on the chat's model; a question after the conversation; a label                   |
| `$.session.*`, `$.turn.abort`                                                                    | The chat's transcript, model, usage, repository and checkpoint; stop the turn                    |
| `$.prompt.submit`, `fill`, `suggest`, `compose`, `read`                                          | A new turn; the message box's draft and its ghost suggestion (Tab); the system prompt's sections |
| `$.ui.open`, `close`, `panes`, `status`, `ask`, `toast`, `log`                                   | Panes in the **Mods** view; the status line under the message box; a question card; notices      |
| `$.store`, `$.fs`, `$.http`, `$.process`, `$.env`, `$.clock`, `$.settings`                       | Supported; files resolve from the project's folder; settings from Claude Code's settings files   |
| `$.audio.speak`, `play`                                                                          | The system's voice and player                                                                    |
| `$.config`                                                                                       | No rows: Localix keeps its settings elsewhere                                                    |
| `$.ui.scroll`, `focus`, `blit`                                                                   | Answer `{ deny }`: Localix scrolls and focuses panes as the person does and draws no raster      |
| Elements `Box`, `Text`, `Button`, `Link`, `Code`, `Markdown`, `Input`, `Select`, `Svg`, `Client` | Drawn with Localix controls; a `Client` runs its surface module in an isolated frame             |

Localix fires the engine's events at these points. `prompt.submit`, `turn.start`, `turn.step` and
`turn.complete` frame each turn; `turn.step` can resend a model request on another model or effort.
`tool.call` wraps every tool call and `tool.check` reviews its permission. `tool.describe`,
`prompt.section`, `prompt.compose`, `prompt.context`, `prompt.attachment` and `attribution.text`
shape what the model reads, kept per conversation until `$.ui.invalidate(event)` so the prompt cache
stays warm.

`agent.offer` and `agent.spawn` filter and adjust delegated tasks, `skill.prompt` rewrites a skill,
and `command.describe` relabels or hides commands. `session.append` rewrites a tool result or an
answer before it is stored, `session.compact` can skip a checkpoint, `session.receive` sees
deliveries, `session.measure` pushes usage after a turn, and `session.attach` and `session.detach`
follow the windows showing the conversation. `plugin.register` lets the project's mods refuse a new
one, and `ui.resolve` restyles the elements its panes draw with.

A hook has 10 seconds of its own time, as in Claude Code; a hook that runs over or throws is
skipped, and the API log names it. `next.to(e, 'append')` passes the rest of the user tier. A module
that does not load shows its error in the **Mods** view, which opens from the rail's overflow menu.
Claude Code's own mods — `diff`, `agents-md`, `sec-default`, `telemetry` — and the
`code-modernization` plugin load and run their hooks, commands and panes in Localix.

## Limits

- A plugin whose components live only in its marketplace entry, such as the `*-lsp` plugins, has
  them when installed through the marketplace, not from its folder alone.
- A hosted `marketplace.json` takes only entries with their own sources, since relative paths have
  no folder to resolve from. `update` and `remove` act on global installs, not project ones. An
  added marketplace is a copy under `~/.localix/marketplaces`: after editing a local one, run
  `/plugin marketplace update <name>`.
- A Default project chat has no project folder, so `--project` there fails with a hint to install
  globally.
- Enabling a plugin with hooks, a hooks module, MCP servers or `bin/` executables lets it run local
  code.

## Related guides

- [Build a plugin or a mini app](plugins.md)
- [Hooks and slash commands](../features/hooks-and-commands.md)
- [Language servers](../features/lsp.md)

## Source of truth

- [The Claude Code plugin format](https://github.com/rsaryev/localix/tree/main/packages/claude-plugin/src)
- [Reading it as Localix's runtime manifest](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/layout/claude-code.ts)
- [Composing a plugin and its mini app](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/layout/compose.ts)
- [The mods runtime](https://github.com/rsaryev/localix/tree/main/apps/api/src/features/mods)
- [Mods engine and elements](https://github.com/rsaryev/localix/tree/main/packages/claude-plugin/src/mods)
- [Hook events and the inert ones](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-hooks/contracts.ts)
- [MCP variable expansion](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/ext/user-config-substitute.ts)
- [Claude Code marketplace names](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/claude-code-marketplace.ts)
- [Marketplace entry sources](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/marketplace-entry-source.ts)
- [Layout tests](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/claude-code-layout.test.ts)
