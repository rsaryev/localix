# Hook handlers

Beyond `command`, a Claude Code hook can call an MCP tool, ask a model for a verdict, or run a small
verifier agent. This page covers how those three handler types read their settings and what their
answers do. Handler support per event is in [Hooks and commands](hooks-and-commands.md).

## MCP tool handlers

An `mcp_tool` handler's `input` is an object of arguments. Every string in it, at any depth, has
each `${path}` replaced by that field of the event JSON, such as `${tool_input.file_path}`; a path
with no value becomes an empty string and an object becomes JSON text. A handler without `input`
sends no arguments. The tool's text is read like command output, and `isError` is a non-blocking
error. `SessionStart` with source `startup` or `resume` skips these handlers, because no MCP server
is up yet; after `/clear` or a checkpoint they run.

## Prompt and agent handlers

`prompt` and `agent` handlers run on `Stop`, `SubagentStop`, `UserPromptSubmit`,
`UserPromptExpansion`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`,
`TaskCreated`, `TaskCompleted`, and, as a verdict that is discarded, `PermissionDenied`; `prompt`
also runs on `PermissionRequest`, where `ok: false` changes nothing. A verdict is
`{"ok": …, "reason": …}`. On `ok: false`:

- `Stop` and `SubagentStop` send the reason back as the next instruction. A prompt hook that also
  answers `"impossible": true` lets the turn end instead, so a condition that can never hold does
  not loop. An agent hook ignores `impossible`.
- `PreToolUse` denies the call. A prompt hook then ends the turn and shows the reason as a warning
  line; with `"continueOnBlock": true`, or from an agent hook, the reason goes back to Claude as the
  tool error and the turn goes on.
- `PostToolUse` follows the same rule: the turn ends unless `continueOnBlock` (always, for an agent
  hook) feeds the reason back.
- `PostToolUseFailure`, `TaskCreated` and a task completed during a turn return the reason as a tool
  error whatever `continueOnBlock` says. `UserPromptSubmit`, `UserPromptExpansion` and
  `PostToolBatch` end the turn with the reason shown.

A hook's `model` can be an alias (`haiku`, `sonnet`, `opus`): the session's own model when it is of
that family, else the newest catalog model of it. A hook that cannot reach a verdict, such as no
provider connection, an unusable model, a failed call or a reply without a verdict, allows the event
and shows a `hook error` line naming the cause; the hook documentation names no fail-closed rule for
these two types.

## Limits

- An `mcp_tool` handler does not wait for a server that is still connecting; a server that is not
  connected is a non-blocking error.
- The hook documentation does not say what a `prompt` or `agent` hook does when the model fails, so
  Localix allows the event and says why. An `onFailure` setting applies to `command` and `http`
  handlers only.

## Related guides

- [Hooks and commands](hooks-and-commands.md)
- [Hook tool calls](hook-tool-calls.md)
- [Install Claude Code plugins](../extending/claude-code-plugins.md)

## Source of truth

- [Prompt and agent verdicts](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-hooks/prompt-hook.ts)
- [MCP tool arguments](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-hooks/mcp-tool-input.ts)
- [Model and verifier evaluators](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/cc-hook-evaluators.ts)
