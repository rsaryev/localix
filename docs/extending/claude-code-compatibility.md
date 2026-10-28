# Claude Code compatibility

Localix reads and runs most of what you built or installed for Claude Code: plugins, skills, slash
commands, agents, hooks, mods, MCP and language servers, output styles, project instructions and
your settings. Compatibility is close, not complete. Use this page to see, area by area, what is
read, where a guide covers the details, and what Localix does not do. It was compared with Claude
Code 2.1.310 and its documentation.

## What works

| Area                              | What Localix reads and runs                                                                                                                                                                                                                                                                                   | Guide                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Plugins                           | `.claude-plugin/plugin.json`, every component folder, Claude Code marketplaces, installs from `/plugin install`, Claude Code's own installs, versions and auto-update                                                                                                                                         | [Claude Code plugins](claude-code-plugins.md), [Plugin updates](plugin-updates.md)                         |
| Skills and commands               | `SKILL.md` and command files from plugins, `~/.claude/skills`, `.claude/skills` and `.claude/commands`, with their frontmatter, arguments, `!command` and `@file`                                                                                                                                             | [Skills](../features/skills.md)                                                                            |
| Everyday slash commands           | `/clear`, `/resume`, `/rename`, `/rewind`, `/plan`, `/context`, `/copy`, `/permissions`, `/config`, `/effort`, `/reload-plugins`, `/reload-skills`, `/compact`, `/init`, `/status`, `/hooks`, `/diff`, `/add-dir` and `/export`, each running what Localix already does, with its arguments offered as crumbs | [Claude Code commands](../features/claude-code-commands.md)                                                |
| Agents                            | Plugin agents, `.claude/agents` and `~/.claude/agents`, and the built-in types `general-purpose`, `Explore` and `Plan`                                                                                                                                                                                        | [Subagents](../features/delegation.md#claude-code-agent-types)                                             |
| Project instructions              | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `~/.claude/CLAUDE.md`, `AGENTS.md`, `.claude/rules` and `@imports`                                                                                                                                                                                       | [Project instructions](../features/project-instructions.md)                                                |
| Hooks                             | Thirty of Claude Code's hook events from plugins and settings files, with its input and output JSON, bar the gaps listed below                                                                                                                                                                                | [Hooks and commands](../features/hooks-and-commands.md), [Hook tool calls](../features/hook-tool-calls.md) |
| Tools as hooks and rules see them | Claude Code's tool names and input and result shapes (`Bash`, `Read`, `Edit`, `Write`, `Grep`, `Glob`, `WebFetch`, `Agent`, `Skill` …)                                                                                                                                                                        | [Hook tool calls](../features/hook-tool-calls.md)                                                          |
| Mods                              | Hooks modules with Claude Code's `$` API, panes, the band above the message box, buttons and their hotkeys                                                                                                                                                                                                    | [Run Claude Code mods](claude-code-mods.md)                                                                |
| Settings                          | `permissions`, `defaultMode`, `hooks`, `env`, `statusLine`, `outputStyle`, `enabledPlugins`, `pluginConfigs`, managed settings and `CLAUDE_CONFIG_DIR`                                                                                                                                                        | [Use your Claude Code settings](claude-code-settings.md)                                                   |
| MCP servers                       | Plugin servers, `.mcp.json`, `~/.claude.json` and managed MCP, with Claude Code's tool names and timeouts                                                                                                                                                                                                     | [MCP](../features/mcp.md)                                                                                  |
| Language servers                  | Plugin `.lsp.json` with its documented fields                                                                                                                                                                                                                                                                 | [Language servers](../features/lsp.md)                                                                     |
| Permission rules                  | `Bash(git push:*)`, `Read(src/**)`, `Edit(…)`, `WebFetch(domain:…)`, `Agent(…)`, `Skill(…)` and `mcp__…`, with deny over ask over allow                                                                                                                                                                       | [Permission rules](../features/permissions.md#claude-code-permission-rules)                                |

## How it is checked

Each area was compared with Claude Code's documentation and with the type declarations Claude Code
writes for mod authors. A difference that broke a real plugin, skill, hook or mod got a test that
failed before its fix. This is a comparison, not a proof: a behavior the documentation does not
describe is a judgment call, and the guides say where Localix made one.

For mods, `scripts/cc-parity` runs one probe mod in the installed Claude Code and in Localix's mods
host and compares, event by event and call by call, the shape of what each hands it. Its test fails
when a shape that matched stops matching. After a new Claude Code release, its snapshot is taken
again and the differences are fixed or listed. See the tool's
[README](https://github.com/rsaryev/localix/blob/main/scripts/cc-parity/README.md).

## Limits

Where Localix has no equivalent, the feature is not offered:

- **Modes and models.** `acceptEdits`, `auto` and `dontAsk` start in Default, and `model` and
  `availableModels` are not read: Localix chooses models through its own provider connections.
- **Sandbox.** `sandbox.*` settings are not applied: Localix has no operating-system sandbox.
- **Terminal-only output.** `terminalSequence`, the `Raster` and `Image` elements, and
  `session_title` and `scratchpad_dir` in hook input have nothing to write to.
- **Mods.** The render sites other than `Pane` and `AbovePrompt`, `classic.*` events, the message
  box's own events and the `claude-code/testing` kit are not part of Localix yet; the full list is
  in [Not yet in Localix](claude-code-mods.md#not-yet-in-localix).
- **Plugins.** Two plugins of the same name from different marketplaces cannot both be installed,
  and a `command` plugin source is refused.
- **Agents.** A delegated agent cannot delegate again, so an `Agent(worker, researcher)` list in
  `tools` limits only an agent that runs as the main thread. In your own agent files (not a
  plugin's) `hooks` and `mcpServers` apply to the child's runs. `permissionMode` applies as
  [Agents](../features/agents.md#what-your-own-agent-files-can-set) describes: Localix has no
  accept-edits, auto or dont-ask mode, so only `default` and `plan` change a child.
- **Agent built-ins.** Localix has no `human` agent: describe yourself in `CLAUDE.md`. The model and
  effort of an agent are your choice in Localix, not the file's `model` and `effort`.
- **Slash commands.** Commands that sign in to an Anthropic account, configure the terminal, use
  Claude Code's cloud, or are bundled skills (`/review`, `/security-review`, `/simplify` …) are
  answered with why they do not apply, and with the Localix equivalent where there is one; see
  [the list](../features/claude-code-commands.md#claude-code-commands-localix-cannot-run).
  `/compact` takes a context checkpoint without a model, so its instructions reach `PreCompact`
  hooks but do not steer the result; `/diff` and `/export` reply in the chat or write a file, and
  open no view. `/init`, `/status`, `/hooks`, `/diff`, `/add-dir`, `/export` and `/compact` are
  reserved: a plugin command or skill of the same name does not run.
- **Hook events.** `Setup`, `DirectoryAdded` and `WorktreeRemove` are accepted and never fire.
- **Hook handlers.** An `mcp_tool` hook does not wait for a server that is still connecting.
  `permissionDecision: "defer"` is warned about and ignored, since Localix has no headless caller to
  resume a call. A `prompt` or `agent` hook that cannot reach a verdict allows the event and shows a
  hook error, because the documentation names no fail-closed rule for it. `SessionStart`'s
  `agent_type` and `InstructionsLoaded`'s `globs`, `trigger_file_path` and `parent_file_path` are
  not sent, since Localix cannot report them truthfully: it reports instruction files only as loaded
  with the session or after a checkpoint.
- **Plugin manifests.** `metadata`, `types` and `experimental.evals` are read and have no effect
  (there is no `claude plugin eval`), and a manifest path to a component folder that does not exist
  yields no components without a note.
- **MCP.** `/mcp` lists servers by source and reconnects, enables or disables one; a server's
  prompts run as `/mcp__<server>__<prompt>`. The menu offers only the prompts of servers already
  connected (typing the command connects the server), and omits those of a plugin's bundled servers,
  though typing one works. Prompt arguments are taken positionally. A `headersHelper` runs for http
  servers only; a `ws` server sends its static `headers`. `/mcp enable` and `disable` set Localix's
  own switch and never write Claude Code's files.
- **Approvals.** An unapproved `.mcp.json` server does not load, since Localix has no approval
  prompt for one; imports from outside a project are skipped.

## Related guides

- [Claude Code plugins](claude-code-plugins.md)
- [Use your Claude Code settings](claude-code-settings.md)
- [Plugin updates](plugin-updates.md)
- [Hooks and commands](../features/hooks-and-commands.md)
- [Skills](../features/skills.md)

## Source of truth

- [Claude Code tool shapes](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/ext/cc-tool-shapes.ts)
- [Mods host](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mods/host.ts)
- [Skill discovery](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/skill-scan.ts)
- [Project instructions](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/context-files.ts)
- [Parity tool](https://github.com/rsaryev/localix/blob/main/scripts/cc-parity/README.md)
