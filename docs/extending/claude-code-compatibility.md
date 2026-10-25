# Claude Code compatibility

Localix runs what you built or installed for Claude Code: plugins, skills, slash commands, agents,
hooks, mods, MCP and language servers, output styles, project instructions and your settings. Use
this page to see, area by area, what works the same, where a guide covers the details, and what
Localix does not do yet. It was checked against Claude Code 2.1.310.

## What works

| Area                              | What Localix reads and runs                                                                                                                                           | Guide                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Plugins                           | `.claude-plugin/plugin.json`, every component folder, Claude Code marketplaces, installs from `/plugin install`, Claude Code's own installs, versions and auto-update | [Claude Code plugins](claude-code-plugins.md), [Plugin updates](plugin-updates.md)                         |
| Skills and commands               | `SKILL.md` and command files from plugins, `~/.claude/skills`, `.claude/skills` and `.claude/commands`, with their frontmatter, arguments, `!command` and `@file`     | [Skills](../features/skills.md)                                                                            |
| Agents                            | Plugin agents, `.claude/agents` and `~/.claude/agents`, and the built-in types `general-purpose`, `Explore` and `Plan`                                                | [Delegation](../features/delegation.md#claude-code-agent-types)                                            |
| Project instructions              | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `~/.claude/CLAUDE.md`, `AGENTS.md`, `.claude/rules` and `@imports`                                               | [Project instructions](../features/project-instructions.md)                                                |
| Hooks                             | Every hook event from plugins and settings files, with Claude Code's input and output JSON                                                                            | [Hooks and commands](../features/hooks-and-commands.md), [Hook tool calls](../features/hook-tool-calls.md) |
| Tools as hooks and rules see them | Claude Code's tool names and input and result shapes (`Bash`, `Read`, `Edit`, `Write`, `Grep`, `Glob`, `WebFetch`, `Agent`, `Skill` …)                                | [Hook tool calls](../features/hook-tool-calls.md)                                                          |
| Mods                              | Hooks modules with Claude Code's `$` API, panes, the band above the message box, buttons and their hotkeys                                                            | [Run Claude Code mods](claude-code-mods.md)                                                                |
| Settings                          | `permissions`, `defaultMode`, `hooks`, `env`, `statusLine`, `outputStyle`, `enabledPlugins`, `pluginConfigs`, managed settings and `CLAUDE_CONFIG_DIR`                | [Use your Claude Code settings](claude-code-settings.md)                                                   |
| MCP servers                       | Plugin servers, `.mcp.json`, `~/.claude.json` and managed MCP, with Claude Code's tool names and timeouts                                                             | [MCP](../features/mcp.md)                                                                                  |
| Language servers                  | Plugin `.lsp.json` with its documented fields                                                                                                                         | [Language servers](../features/lsp.md)                                                                     |
| Permission rules                  | `Bash(git push:*)`, `Read(src/**)`, `Edit(…)`, `WebFetch(domain:…)`, `Agent(…)`, `Skill(…)` and `mcp__…`, with deny over ask over allow                               | [Permission rules](../features/permissions.md#claude-code-permission-rules)                                |

## How it is checked

Each area was compared with Claude Code's documentation and with the type declarations Claude Code
writes for mod authors. Every difference that broke a real plugin, skill, hook or mod has a test in
Localix that failed before the fix.

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
- **Agents.** A delegated agent cannot delegate again. An agent file's `hooks` run, while its
  `mcpServers` and `permissionMode` are not applied. The built-in types `statusline-setup` and
  `claude-code-guide` are not offered, and Localix has no `human` agent: describe yourself in
  `CLAUDE.md`. Localix's own settings for an agent (`priority`, `memoryScope`, a provider route) sit
  under a `localix:` key, which Claude Code ignores.
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
