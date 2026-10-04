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
validates positional text and choice arguments, expands supported variables and dynamic content,
then starts a macro run. Dynamic option scripts stay server-side; clients receive only their
returned choices.

| Category          | Core commands                                          |
| ----------------- | ------------------------------------------------------ |
| Autonomous        | `/loop`                                                |
| Configuration     | `/model` (`/models`), hidden `/reasoning`              |
| Context           | `/clear`, client-scoped `/fork`, client-scoped `/open` |
| Information       | `/help`, `/usage` (`/cost`)                            |
| Memory and skills | `/memory`, `/skills` (`/skill`)                        |
| Extensions        | `/mcp`, `/plugin`, `/provider`                         |

### Native plugin hooks

Native hooks are callbacks returned by an enabled plugin's `register(ctx)` function.

| Hook                               | Primary effect                                                 | Boundary                                                               |
| ---------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `onSessionStart`                   | Observe the first run of a session through the plugin context. | Fires once per session per API process and is not awaited.             |
| `onUserMessage`                    | Rewrite the model-facing prompt.                               | The persisted user message does not change.                            |
| `onPreToolCall`                    | Observe, rewrite, or block built-in, plugin, and MCP calls.    | A rewrite is schema-checked when the tool exposes a compatible schema. |
| `onPostToolCall`                   | Replace result content or append a plugin note.                | Appended text is capped at 1 KiB per hook result.                      |
| `onAssistantMessage`               | Replace persisted assistant text or add message bindings.      | Content must be non-empty; bindings are validated and capped.          |
| `onSessionEnd`                     | Observe the end of each run.                                   | It is not a logical session-deletion event.                            |
| `onSubagentStop`                   | Observe a child session reaching a terminal status.            | Observer-only.                                                         |
| `onHitlRequest` / `onHitlResolved` | Observe human-input request lifecycle.                         | These hooks cannot answer or veto the request.                         |

Native rewrites compose in plugin load order. Tool pre-hooks stop at the first block; post-hooks all
run and later hooks see earlier replacements.

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

## Configuration

### Contribution locations

| Contribution             | Accepted source                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Plugin slash command     | Inline `commands` entries in `plugin.json`, declared Markdown paths, or the default `commands/` tree |
| Declarative plugin hooks | Inline `hooks` in `plugin.json`, declared JSON paths, or default `hooks/hooks.json`                  |
| Run-scoped hooks         | `hooks` frontmatter on the invoked skill or delegated agent                                          |
| Native plugin hooks      | `hooks` returned from the plugin's `register(ctx)` function                                          |

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

Command-hook stdout and stderr capture is capped at 64 KiB. A command handler with `async: true`
cannot affect the current event. `asyncRewake` can wake an idle session when that command exits with
code 2. That wake is armed when the hook starts and delivered at most once; a hook that exits any
other way, or is lost to an API restart, wakes nobody.

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
- Async command handlers are observer-only for the current event. Their decision fields cannot block
  or rewrite in-flight work.
- Native hook failures are isolated. Native plugin hook callbacks other than `onSessionStart` use a
  five-second wait; `onSessionStart` is fire-and-forget.
- `/fork` and `/open` require web/desktop. A client without those surfaces omits them from its
  forwarded server command list.
- A plugin or skill macro sent while a run is active waits in the queue as a whole command — its
  badge, model override, tool grants and hooks — and runs as its own turn. Context commands such as
  `/clear` still require an idle session.
- `/model` and `/reasoning` act on one participant: the one named first (`/model @qa sonnet`),
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
- [Native hook contracts](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/backend/hooks.ts)
- [Native hook dispatch](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/hooks.ts)
- [Declarative hook contracts](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-hooks/contracts.ts)
- [Declarative hook registry](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-hooks/config.ts)
- [Declarative hook runtime](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/cc-hooks/run.ts)
