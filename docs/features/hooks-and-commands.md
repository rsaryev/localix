# Use hooks and slash commands

Slash commands turn `/…` input into session controls or extension macros. Hooks let enabled plugins
or an invoked skill or agent run handlers at defined runtime boundaries.

## What you can do

| Outcome                     | Mechanism                                                                            | Boundary                                                      |
| --------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Run session controls        | Select a core command for models, reasoning, context, loops, or extensions.          | Client-scoped commands depend on the active client.           |
| Invoke an extension macro   | Run a command contributed by an enabled plugin or user-invocable skill.              | Macros start model work; during a run they wait in the queue. |
| Gate prompts or tools       | Use native `onPreToolCall` or declarative `UserPromptSubmit` and `PreToolUse` hooks. | The plugin or run-scoped declaration must be active.          |
| Transform model-facing data | Rewrite prompts, tool inputs, tool outputs, assistant text, or added context.        | Each hook contract controls which persisted data can change.  |
| Observe lifecycle events    | Receive run, worker, context-checkpoint, and human-input events.                     | Observer hooks cannot answer a human-in-the-loop request.     |

## How it works

### Slash-command dispatch

Web/desktop derives its built-in menus from the shared slash catalog, then merges enabled plugin
commands and user-invocable skills for the active scope.

| Order | Owner                | Dispatch behavior                                                                      |
| ----- | -------------------- | -------------------------------------------------------------------------------------- |
| 1     | Compatible client    | Handles client commands such as `/fork` and `/open` before an API turn.                |
| 2     | Core API catalog     | Resolves canonical names and aliases to typed control handlers.                        |
| 3     | Enabled plugin       | Resolves `/<plugin>:<command>` or a collapsed same-name command such as `/review`.     |
| 4     | User-invocable skill | Resolves `/<skill-name>` when no earlier owner claimed it.                             |
| 5     | Unresolved gate      | Returns an error and suggestions instead of sending command-shaped input to the model. |

A core name or alias wins a collision. Plugin commands are agent prompt templates: the backend
validates positional arguments and static choices, expands supported variables and dynamic content,
then starts a macro run. Dynamic option scripts stay server-side; clients receive only their
returned choices.

Arguments are positional. Non-final text and choice fields consume whitespace-delimited tokens; only
a final text field captures the remainder. Static choices must match a declared value, while dynamic
choices accept any non-empty token without checking the returned menu. A conditional argument whose
earlier value does not match is skipped. Extra tokens are not rejected by the declared-argument
parser; `$ARGUMENTS` can still include the complete raw input.

Template-authored shell embeds and file references expand before user argument values are inserted.
An argument containing `!` command syntax or `@path` therefore does not start another preprocessing
pass. Template shell commands still execute local code directly before the macro runs; inline tool
grants do not govern that preprocessing.

| Category          | Core commands                                |
| ----------------- | -------------------------------------------- |
| Autonomous        | `/loop`                                      |
| Configuration     | `/model` (`/models`)                         |
| Context           | client-scoped `/fork`, client-scoped `/open` |
| Information       | `/help`, `/usage` (`/cost`)                  |
| Memory and skills | `/memory`, `/skills` (`/skill`)              |
| Extensions        | `/mcp`, `/plugin`, `/provider`               |

### Native plugin hooks

Native hooks are callbacks returned by an enabled plugin's `register(ctx)` function.

| Hook                               | Primary effect                                                 | Boundary                                                               |
| ---------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `onSessionStart`                   | Observe the first run of a session through the plugin context. | Fires once per session per API process and is not awaited.             |
| `onUserMessage`                    | Rewrite the model-facing prompt.                               | The persisted user message does not change.                            |
| `onPreToolCall`                    | Observe, rewrite, or block built-in, plugin, and MCP calls.    | A rewrite is schema-checked when the tool exposes a compatible schema. |
| `onPostToolCall`                   | Replace result content or append a plugin note.                | Appended text is capped at 1,024 UTF-16 code units per hook result.    |
| `onAssistantMessage`               | Replace persisted assistant text or add message bindings.      | Content must be non-empty; bindings are validated and capped.          |
| `onSessionEnd`                     | Observe the end of each run.                                   | It is not a logical session-deletion event.                            |
| `onSubagentStop`                   | Observe a child session reaching a terminal status.            | Observer-only.                                                         |
| `onHitlRequest` / `onHitlResolved` | Observe human-input request lifecycle.                         | These hooks cannot answer or veto the request.                         |

Native rewrites compose in plugin load order. Tool pre-hooks stop at the first block; post-hooks all
run and later hooks see earlier replacements.

Post-hooks also see execution errors converted into tool results; a pre-hook block skips execution
and post-hooks. Assistant hooks can add at most eight bindings in total, with an 8 MiB payload cap
per binding. These caps do not impose an aggregate limit on replacement message or tool text.

### Declarative hooks

Declarative hooks use the supported hooks JSON schema from enabled plugins or `hooks` frontmatter on
the invoked skill or delegated agent. Localix dispatches these events:

`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionEnd`,
`SubagentStart`, `SubagentStop`, `PreCompact`, and `Notification`.

`PreCompact` fires with trigger `auto` when a [context checkpoint](context-checkpoints.md) is taken.
The view is already decided by then, so a block is logged and never stops the turn; the next run
fires `SessionStart` with source `compact`.

Matching synchronous handlers run in declaration and plugin load order. `PreToolUse` input rewrites
compose and the first deny stops the call. `PostToolUse` replacements are visible to later handlers.

| Event                       | Effect of a blocking verdict                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `UserPromptSubmit`          | Rejects the prompt at the first block.                                                          |
| `PreToolUse`                | Stops the tool at the first deny; `allow` and `ask` remain advisory.                            |
| `PostToolUse`               | Cannot undo execution; a block reason becomes added result context.                             |
| `Stop`                      | Requests another run with the reason, subject to continuation gates and a five-run cap.         |
| Scoped child `SubagentStop` | Can request the same bounded continuation in the child; parent observation does not restart it. |
| `PreCompact`                | Reports the block without stopping the checkpoint.                                              |
| Other lifecycle events      | Do not stop the run; context or observer effects depend on the event.                           |

### Matcher, `if`, and `once`

Tool-event matchers accept engine names and compatible aliases such as `Bash`, including MCP name
forms. Empty, omitted, or `*` matchers match all. Simple names separated by `|` or commas compare
case-insensitively; other patterns are unanchored JavaScript regular expressions. Invalid regexes do
not match. `UserPromptSubmit` and `Stop` ignore group matchers; other lifecycle matchers inspect the
event's source, reason, agent type, notification type, or checkpoint trigger.

A handler's `if` is one permission-style rule evaluated against the original tool input before
rewrites. It applies only to `PreToolUse` and `PostToolUse`; carrying it on another event prevents
that handler from running. Unparseable rules or unavailable comparison fields let the handler run.
This filter does not grant tool permission.

`once: true` is tracked per session in API-process memory. Selection consumes the marker even if the
handler later fails or an earlier handler blocks. The key combines event, source, plugin name, and
command or prompt text; identical keys share a marker, including HTTP/MCP handlers with empty
command and prompt fields. API restart or session runtime cleanup clears these markers.

## Configuration

### Contribution locations

| Contribution             | Accepted source                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Plugin slash command     | Inline `commands` entries in `plugin.json`, declared Markdown paths, or the default `commands/` tree |
| Declarative plugin hooks | Inline `hooks` in `plugin.json`, declared JSON paths, or default `hooks/hooks.json`                  |
| Run-scoped hooks         | `hooks` frontmatter on the invoked skill or delegated agent                                          |
| Native plugin hooks      | `hooks` returned from the plugin's `register(ctx)` function                                          |

Inline commands win same-name collisions with command Markdown files. Explicit file/path entries win
over the default directory, and nested paths become colon-separated names. Localix-native plugins
scan the default tree additively; declared safe paths on compatibility-origin plugins replace that
default scan. Markdown commands need a non-empty body in a regular UTF-8 file up to 1 MiB. Discovery
considers at most 64 declared roots, eight directory levels, and 2,000 entries per scanned root, and
checks canonical paths against the plugin directory.

### Plugin command example and options

```json
{
  "commands": [
    {
      "name": "review",
      "args": [{ "name": "request", "type": "text", "required": true }],
      "prompt": "Review the requested change and report concrete findings: ${request}"
    }
  ]
}
```

For a plugin named `team-tools`, this entry runs as `/team-tools:review <request>`. The JSON is a
manifest fragment; it still needs the plugin's required manifest fields.

An options script runs directly through Bun when the composer requests choices for an enabled
plugin. It receives `{ query, cwd, sessionId, argName, command, config }` JSON on stdin and returns
a JSON array of strings or `{ value, label?, description? }` objects on stdout. Valid rows are
normalized, with at most 200 returned. The run has an eight-second deadline and a 256 KiB stdout
capture ceiling. A parse failure or timeout yields an empty menu; a non-zero exit alone does not
discard otherwise usable stdout.

The working directory is the resolved session directory, otherwise the project directory, otherwise
the shared Localix workspace. The script path must be lexically within the plugin directory, but
this path check does not resolve symlink targets. This subprocess has normal local access and runs
outside Bash tool approval. Treat it as executable plugin code, rather than a sandboxed lookup.

### Declarative handler support

| Handler    | Primary mechanism                                                                                                   | Boundary                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `command`  | Runs the agent's Bash (`bash -c`; Git Bash on Windows), sends event JSON on stdin, and folds exit code plus output. | Supported on every dispatched event.                                                                    |
| `http`     | POSTs event JSON and folds a successful response like command output.                                               | Unsupported on `SessionStart`; network and non-2xx failures do not block.                               |
| `mcp_tool` | Calls a gathered MCP tool with the event JSON.                                                                      | Missing, disconnected, or failed tools do not block.                                                    |
| `prompt`   | Uses one auxiliary model call to return an allow/block verdict.                                                     | Only `Stop`, `SubagentStop`, `UserPromptSubmit`, and `PreToolUse`; requires a live provider connection. |
| `agent`    | Runs a bounded read-only verifier with `read` and `search`.                                                         | Same four events; requires the agent service and a live provider connection.                            |

| Handler                       | Default timeout | Additional cap                                                   |
| ----------------------------- | --------------- | ---------------------------------------------------------------- |
| `command`, `http`, `mcp_tool` | 600 seconds     | Declared timeouts are capped at 1,800 seconds.                   |
| `prompt`                      | 30 seconds      | Declared timeouts are capped at 1,800 seconds.                   |
| `agent`                       | 60 seconds      | Default 50 turns; declared timeouts are capped at 1,800 seconds. |

A `command` handler's `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}`
are expanded by the shell from the child environment, not pasted into the command text, and a
non-secret `${user_config.KEY}` becomes `${CLAUDE_PLUGIN_OPTION_<KEY>}` with its value in the
environment. A project path or config value is therefore data even when it contains `$(…)`, quotes
or backticks. Quote the placeholder (`"${CLAUDE_PROJECT_DIR}"`) when the value may contain spaces.
Plugin monitor commands follow the same rule. An `http` handler's URL is not shell text, so its
placeholders are substituted directly.

Command-hook stdout and stderr capture is capped at 64 KiB each. Declarative post-tool appended
context has a separate aggregate cap of 4,096 UTF-16 code units. A command handler with
`async: true` cannot affect the current event. `asyncRewake` can wake an idle session when that
command exits with code 2. That wake is armed when the hook starts and delivered at most once; a
hook that exits any other way, or is lost to an API restart, wakes nobody.

## Limits

- Localix does not load hooks from ambient user, project, or local settings files. Declarative hooks
  enter through an enabled plugin or the invoked skill or agent's run-scoped frontmatter.
- Enabling a hook-bearing plugin is a code-execution trust decision. Native and command hooks can
  run local code; HTTP hooks make network requests; MCP, prompt, and agent hooks invoke their named
  runtimes.
- Unsupported event and handler combinations are skipped during parsing. They do not execute.
- Declarative `PreToolUse` `allow` is advisory and cannot bypass the Localix permission gate. A deny
  can still stop the tool.
- Prompt, agent, MCP, HTTP, and command handler failures are non-blocking unless the handler returns
  a supported blocking verdict. Missing provider or MCP connections therefore fail open.
- Malformed auxiliary-model verdicts also allow the event to continue. Prompt hooks make billed
  model calls; agent hooks create verifier jobs, with a default of 50 turns rather than a fixed
  maximum for every declaration.
- MCP hook calls still obey agent capability and permission rules. Calls requiring denial or
  confirmation do not execute through the hook path; their hook verdict fails open.
- Command hooks spawn directly through the resolved shell, outside Bash tool approval. Timeout or
  cancellation kills the shell child; it does not undo prior effects or guarantee descendant
  cleanup.
- Async command handlers are observer-only for the current event. Their decision fields cannot block
  or rewrite in-flight work.
- Native callbacks other than `onSessionStart` isolate failures and use a five-second wait per
  callback. The timeout stops waiting without cancelling callback work. It cannot interrupt
  synchronous JavaScript that blocks the API event loop.
- `onSessionStart` is fire-and-forget with rejected promises logged. A synchronous throw from the
  callback occurs before that promise handler and can propagate into run startup.
- `/fork` and `/open` require web/desktop. A client without those surfaces omits them from its
  forwarded server command list.
- A plugin or skill macro sent while a run is active waits in the queue as a whole command — its
  badge, model override, tool grants and hooks — and runs as its own turn.
- `/model` walks the model picker's steps in the composer — agent (groups only, with **All
  agents**), provider, model, then optional reasoning, turns and context window settings — and never
  prints a model list. See [Switch models with `/model`](conversations.md#switch-models-with-model).
  Typed as `/model <name>`, it acts on one participant: the one named first (`/model @qa sonnet`),
  otherwise the participant your unaddressed message would go to.

## Related guides

- [Your first session](../getting-started/first-session.md)
- [Plugins](../extending/plugins.md)
- [Skills](skills.md)
- [Skill authoring](../extending/skills-authoring.md)
- [Human-in-the-loop controls](hitl.md)

## Source of truth

- [Core slash-command catalog](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/slash-catalog.ts)
- [Slash parser](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/slash-commands.ts)
- [Turn dispatch order](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/turn-entry.ts)
- [Plugin and skill command handlers](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/command-handlers.ts)
- [Plugin command schema](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/contracts-commands.ts)
- [Plugin command argument parsing and rendering](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/plugin-commands.ts)
- [Command Markdown discovery](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/discovery-cc-files.ts)
- [Manifest command precedence](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/manifest-load.ts)
- [Dynamic option execution](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/arg-options.ts)
- [Native hook contracts](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/backend/hooks.ts)
- [Native hook dispatch](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/hooks.ts)
- [Native tool-hook composition and limits](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/hooks-tools.ts)
- [Native message hooks and bindings](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/hooks-messages.ts)
- [Native hook wait and isolation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/hook-invoke.ts)
- [Session-start dispatch](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/session-start-hooks.ts)
- [Declarative hook contracts](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-hooks/contracts.ts)
- [Declarative hook registry](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-hooks/config.ts)
- [Declarative hook runtime](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-hooks/run.ts)
- [Matcher semantics](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-hooks/matcher.ts)
- [Secondary `if` filter](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-hooks/if-guard.ts)
- [Tool rewrite and output folding](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-hooks/wrap-tools.ts)
- [Bounded continuation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/run-continuations.ts)
- [Model-backed evaluators](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/cc-hook-evaluators.ts)
- [MCP hook permission gate](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/mcp-hook-caller.ts)
- [Command transport and cancellation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/lifecycle-hooks/command.ts)
