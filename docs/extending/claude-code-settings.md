# Use your Claude Code settings

Localix reads the configuration you already wrote for Claude Code, so your rules, hooks, servers and
status line work in Localix conversations without copying them. Use this page to see which files and
keys Localix reads, how it combines them, and which ones it leaves to Claude Code. Localix never
writes these files.

## What you can do

| Outcome                                           | Where it comes from                                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep your allow, ask and deny rules               | `permissions` — see [Permission rules](../features/permissions.md#claude-code-permission-rules)                                                    |
| Start in the mode you set                         | `permissions.defaultMode`, `disableBypassPermissionsMode` — see [Permission modes](../features/permission-modes.md#mode-settings-from-claude-code) |
| Run your hooks                                    | `hooks`, `disableAllHooks`, `allowManagedHooksOnly` — see [Hooks and commands](../features/hooks-and-commands.md)                                  |
| Connect your MCP servers                          | `~/.claude.json`, `.mcp.json`, managed MCP — see [MCP](../features/mcp.md)                                                                         |
| Stop skills from running shell commands           | `disableSkillShellExecution` — see [Keys that lock things down](#keys-that-lock-things-down)                                                       |
| Load skills, agents, hooks, MCP from plugins only | `strictPluginOnlyCustomization` (managed) — see [Keys that lock things down](#keys-that-lock-things-down)                                          |
| Give shell commands, hooks and servers your `env` | `env`                                                                                                                                              |
| See your status line under the message box        | `statusLine`, `subagentStatusLine`                                                                                                                 |
| Use your output styles                            | `outputStyle`, `.claude/output-styles/`                                                                                                            |
| Load the plugins you installed in Claude Code     | `enabledPlugins`, `pluginConfigs` — see [Claude Code plugins](claude-code-plugins.md)                                                              |

## How it works

### Which files are read

Each run reads the files Claude Code would read for the conversation's folder:

| Scope   | File                                                                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| User    | `~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json` when that is set                                                              |
| Project | the folder's `.claude/settings.json`                                                                                                           |
| Local   | `.claude/settings.local.json` at the repository root (a worktree's main checkout), and the folder's own                                        |
| Managed | `managed-settings.json` and `managed-settings.d/*.json` in the system directory, or the macOS configuration profile `com.anthropic.claudecode` |

The system directory is `/Library/Application Support/ClaudeCode` on macOS, `/etc/claude-code` on
Linux and `C:\Program Files\ClaudeCode` on Windows. `CLAUDE_CONFIG_DIR` also moves where plugins,
output styles and Claude Code's state file (`.claude.json`) are read from.

### How they combine

A higher file wins a single value: managed over local over project over user. Lists such as
`permissions.allow` combine across files without repeats, and blocks such as `env` merge key by key.
`fallbackModel` and `modelPicker` are taken whole, and a managed `availableModels` applies as is.
Permission rules combine as Claude Code combines them: a deny in any file beats an ask in any file,
which beats an allow.

### What waits for workspace trust

What a repository grants — the `allow` rules and `additionalDirectories` of its committed
`.claude/settings.json`, its `env`, its hooks, and the approval of its own `.mcp.json` servers —
applies once you trusted the folder in Claude Code (`hasTrustDialogAccepted` for the folder in
`~/.claude.json`). Rules that only restrict, `deny` and `ask`, apply at once.

### Keys that lock things down

Two keys limit what loads or runs, and are meant for managed settings.

- **`disableSkillShellExecution`** (any file; a managed `true` cannot be turned off). Every inline
  `!` command and fenced `!` block of a skill or command from your folders, a project or a plugin is
  replaced by `[shell command execution disabled by policy]` and is not run. Skills of Localix's
  built-in plugins are not affected. See
  [Skill authoring](skills-authoring.md#dynamic-command-context).
- **`strictPluginOnlyCustomization`** (managed settings only; a user, project or local file with the
  key is ignored). `true` locks all four kinds, or list the kinds to lock: `"skills"`, `"agents"`,
  `"hooks"`, `"mcp"`. A name Localix does not know is ignored, as in Claude Code. A locked kind
  loads only from plugins and managed settings:

| Kind     | Closed                                                                                                                                                                          | Still loads                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `skills` | skills and commands of `~/.claude/skills`, `.claude/skills`, `~/.claude/commands`, `.claude/commands`, and Localix's own `.localix/skills` and `.agents/skills`                 | plugin skills and commands, built-in plugins                                          |
| `agents` | `~/.claude/agents/` and a project's `.claude/agents/`                                                                                                                           | built-in types, the managed folder's agents, plugin agents                            |
| `hooks`  | `hooks` of user, project and local settings; the `hooks` of a skill still read from your folders (that skill also loses its `allowed-tools` pre-approval unless it runs forked) | the organization's settings hooks and every plugin's hooks                            |
| `mcp`    | servers of `~/.claude.json` and `.mcp.json`                                                                                                                                     | `managed-mcp.json`, `managedMcpServers`, plugin servers, servers you added in Localix |

Localix has no skills-directory plugins, `--add-dir` folders, claude.ai-synced skills or managed
skills folder, so nothing of those kinds loads to lock. A skill you save from a conversation lands
in `.localix/skills`, which a `skills` lock closes. The `hooks` lock reads managed settings files; a
macOS profile applies to skills and agents, but the hooks of a run read the files only.

### Environment variables

The `env` of the settings reaches shell commands, hooks and stdio MCP servers of a run in that
folder, and the `${VAR}` expansion of MCP servers. A project's `env` cannot set the variables Claude
Code keeps out of a repository's reach, such as `CLAUDE_CONFIG_DIR`, `HOME` or the OpenTelemetry
exporters. MCP limits (`MCP_TIMEOUT`, `MCP_TOOL_TIMEOUT`, `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`,
`MAX_MCP_OUTPUT_TOKENS`) are read from it too.

### Status line

The `statusLine` command runs in the conversation's folder with the session on stdin as Claude
Code's JSON — `session_id`, `session_name`, `cwd`, `workspace`, `model`, `cost`, `context_window`,
`effort` — and what it prints is drawn under the message box, with any mod's status line. Colors and
links are stripped and several rows are joined with `·`. It runs when the conversation opens or
changes, 300 ms after the last change, and every `refreshInterval` seconds while you look at it. A
command that fails or prints nothing clears the line. A `subagentStatusLine` in your own settings
rewrites the subagent rows, over a plugin's.

## Limits

These keys and sources do not change Localix:

| Claude Code setting                                                                                                     | Why                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `acceptEdits`, `auto` and `dontAsk` in `defaultMode`                                                                    | Localix has no mode of the same meaning; such a conversation starts in Default.                               |
| `model`, `availableModels`, `fallbackModel`, `effortLevel`, `ANTHROPIC_MODEL` and the model variables                   | Localix routes models through its own provider connections and the model picker.                              |
| `apiKeyHelper`, `forceLoginMethod`, `awsAuthRefresh` and other sign-in keys                                             | Localix signs in to providers itself.                                                                         |
| `sandbox.*`                                                                                                             | Localix runs commands without an operating-system sandbox; permission rules are application policy.           |
| `attribution`, `includeCoAuthoredBy`, `cleanupPeriodDays`, `theme`, `spinnerTips*`, `language` and other interface keys | They describe Claude Code's own interface and history.                                                        |
| `BASH_DEFAULT_TIMEOUT_MS`, `BASH_MAX_TIMEOUT_MS`, `BASH_MAX_OUTPUT_LENGTH`                                              | Localix's shell tool has its own limits.                                                                      |
| Server-managed settings from claude.ai, and the Windows registry policy                                                 | They need Claude Code's sign-in or the registry; managed files and the macOS profile are read.                |
| A `.mcp.json` server no setting approves                                                                                | Localix does not show Claude Code's approval prompt: approve it in Claude Code or in `enabledMcpjsonServers`. |
| Sensitive plugin options                                                                                                | Claude Code keeps them in the system keychain; Localix asks for them in the plugin's settings.                |
| `--settings`, `--setting-sources` and other command-line flags                                                          | Localix does not start Claude Code's command line.                                                            |

`Bash` allow rules are matched by Localix's own command patterns, which do not strip `timeout` or
`nice` before the command the way Claude Code does; deny and ask rules do.

## Related guides

- [Permission rules](../features/permissions.md)
- [Permission modes](../features/permission-modes.md)
- [Hooks and commands](../features/hooks-and-commands.md)
- [MCP](../features/mcp.md)
- [Install Claude Code plugins](claude-code-plugins.md)

## Source of truth

- [Settings files and merge](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-settings/settings-files.ts)
- [Managed settings](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-settings/managed-settings.ts)
- [Permission rules](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-settings/settings-permissions.ts)
- [Settings env](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-settings/settings-env.ts)
- [Settings hooks](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-settings/settings-hooks.ts)
- [Claude Code MCP servers](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mcp/claude-code-servers.ts)
- [Status line](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/status-line.ts)
