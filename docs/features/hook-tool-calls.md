# Hook tool calls

A Claude Code hook reads a Localix tool call under Claude Code's tool name and with Claude Code's
fields, so a plugin written for Claude Code matches and reads it unchanged. This page lists how each
call reaches a hook and what it reads back.

## What you can do

- Match `Bash`, `Edit`, `Write`, `Read`, `Grep`, `Glob`, `Agent`, `Skill`, `WebFetch`, `Workflow`
  and the other Claude Code tool names in a `PreToolUse` or `PostToolUse` matcher.
- Read `tool_input.file_path`, `tool_input.command` and the other Claude Code fields.
- Read `tool_response` in the tool's Claude Code shape, and replace it with `updatedToolOutput`.

## How it works

A tool call reaches a hook under Claude Code's name, with Claude Code's fields beside Localix's:
`Bash`, `Read`, `Write`, `Edit`, `Grep`, `AskUserQuestion`, `Workflow`, `Agent` for starting a
delegated task, `Skill` for running a skill, and `WebFetch` for a research call that reads named
pages or `WebSearch` for one that searches. A call with no Claude Code counterpart, such as listing
delegated tasks or saving a skill, keeps Localix's name.

An edit, write or read that names several files runs the tool hooks once per file, each as a
one-file `Edit`, `Write` or `Read` with its `file_path`; a deny of any file refuses the call, and an
allow approves it only when every file is allowed.

A PostToolUse hook reads `tool_response` in that tool's Claude Code shape: Bash's `stdout` and
`stderr` apart with `interrupted`, Write's `type`, `filePath`, `content` and `structuredPatch`,
Edit's `filePath`, `oldString`, `newString` and hunks, Read's `{type, file}`, and WebFetch's `url`
and `result`; an `updatedToolOutput` in that shape replaces what the model sees. Localix does not
keep a file's text from before a write, so `originalFile` is `null`.

Hooks also read `prompt_id` (the message being answered), `effort.level` and the `CLAUDE_EFFORT`
variable, SessionStart's `model`, PostToolUse's `duration_ms`, and on `Stop` and `SubagentStop` the
session's running jobs, monitors and delegated tasks as `background_tasks` and its loops as
`session_crons`. Two fields are never sent: `scratchpad_dir`, since a Localix session has no
scratchpad, and `session_title`, since Localix does not record whether a person named the session.

A `PermissionRequest` hook reads the card's widenings as `permission_suggestions`: an `addRules`
allow entry for the session, and for the settings destinations when the breadth can be saved as an
"Always" rule. Echoing one back in `updatedPermissions` grants it as picking it on the card would;
an entry that is none of the suggestions grants nothing. PreToolUse's deprecated top-level
`decision: "approve"` reads as `allow`.

### Tool names and shapes

A hook reads each Localix tool under its Claude Code name, with `tool_input` and `tool_response` in
that tool's shape. Localix's own fields stay beside them, and a hook's `updatedInput` is folded back
into them. File paths are absolute.

| Localix tool     | `tool_name` for the call                                               | `tool_response`                                          |
| ---------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| `bash`           | `Bash`; a batch of commands is one `command` line                      | `stdout`, `stderr`, `interrupted`, `isImage`             |
| `read`           | `Read`; a line range is `offset` and `limit`                           | `{type: "text", file: {filePath, content, …}}`, or image |
| `edit`, `write`  | `Edit`, `Write` for one file                                           | `filePath`, `structuredPatch`; Write's `type`, `content` |
| `search`         | `Glob` for a file listing, otherwise `Grep`                            | Glob's `filenames`; Grep's `content`, `filenames`        |
| `research`       | `WebFetch` for known URLs, otherwise `WebSearch`                       | WebFetch's `result`; WebSearch's `results`               |
| `delegate`       | `Agent` to start, `SendMessage`, or `TaskStop`                         | `status`, `agentId`, `content`                           |
| `skill`          | `Skill` (`skill`, `args`)                                              | `success`, `commandName`                                 |
| `ask`            | `AskUserQuestion`; `answers` from `updatedInput` answer without a card | `questions`, `answers`                                   |
| `plan`           | `ExitPlanMode` to present a plan                                       | `plan`                                                   |
| `loops`          | `CronCreate`, `CronDelete`, `CronList` or `ScheduleWakeup`             | Localix's own                                            |
| `jobs`           | `TaskStop` to stop a job                                               | Localix's own                                            |
| `activate_tools` | `ToolSearch` (`select:<names>`)                                        | Localix's own                                            |
| `mcp_resources`  | `ListMcpResourcesTool` or `ReadMcpResourceTool`                        | Localix's own                                            |
| An MCP tool      | `mcp__<server>__<tool>`                                                | Its content blocks                                       |

Any other tool keeps its Localix name and shape. A call with no Claude Code counterpart, such as one
edit call over several files, keeps Localix's `{content, details}` response. `PostToolUse` and
`PostToolUseFailure` carry `tool_use_id` and `duration_ms`. `updatedToolOutput` in the shape of
Read, Grep, Glob, WebFetch or WebSearch replaces the text the model reads. Bash output arrives
merged in `stdout`.

`once: true` applies only to hooks in skill frontmatter; a plugin's `hooks.json` and agent
frontmatter ignore it. The hook is removed after its first successful run. A run that fails, blocks
with exit code 2, or times out leaves it in place for the next matching event. The marker is tracked
per session in API-process memory, and its key combines event, source, plugin name, and command or
prompt text. API restart or session runtime cleanup clears these markers.

## Limits

- A background command's `tool_response` carries what it printed before the call returned; a command
  running in a terminal pane writes one stream, so its `stderr` is empty.

## Related guides

- [Hooks and commands](hooks-and-commands.md)
- [Install Claude Code plugins](../extending/claude-code-plugins.md)

## Source of truth

- [Tool shapes](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/ext/cc-tool-shapes.ts)
- [Tool responses](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/ext/cc-tool-responses.ts)
- [Per-file hook calls](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-hooks/runtime-file-calls.ts)
