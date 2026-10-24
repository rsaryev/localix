# Use hooks and slash commands

Slash commands turn `/…` input into session controls or extension macros. Hooks let enabled plugins
and mini apps, or an invoked skill or agent, run handlers at defined runtime boundaries.

## What you can do

| Outcome                     | Mechanism                                                                            | Boundary                                                      |
| --------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Run session controls        | Select a core command for models, reasoning, context, loops, or extensions.          | Client-scoped commands depend on the active client.           |
| Invoke an extension macro   | Run a command from an enabled plugin or mini app, or a user-invocable skill.         | Macros start model work; during a run they wait in the queue. |
| Gate prompts or tools       | Use native `onPreToolCall` or declarative `UserPromptSubmit` and `PreToolUse` hooks. | The extension or run-scoped declaration must be active.       |
| Transform model-facing data | Rewrite prompts, tool inputs, tool outputs, assistant text, or added context.        | Each hook contract controls which persisted data can change.  |
| Observe lifecycle events    | Receive run, worker, context-checkpoint, and human-input events.                     | Observer hooks cannot answer a human-in-the-loop request.     |

## How it works

### Slash-command dispatch

Web/desktop derives its built-in menus from the shared slash catalog, then merges enabled plugin and
mini app commands and user-invocable skills for the active scope.

| Order | Owner                | Dispatch behavior                                                                      |
| ----- | -------------------- | -------------------------------------------------------------------------------------- |
| 1     | Compatible client    | Handles client commands such as `/fork` and `/open` before an API turn.                |
| 2     | Core API catalog     | Resolves canonical names and aliases to typed control handlers.                        |
| 3     | Enabled extension    | Resolves `/<name>:<command>` or a collapsed same-name command such as `/review`.       |
| 4     | User-invocable skill | Resolves `/<skill-name>` when no earlier owner claimed it.                             |
| 5     | Unresolved gate      | Returns an error and suggestions instead of sending command-shaped input to the model. |

A core name or alias wins a collision. Plugin and mini app commands are agent prompt templates: the
backend validates positional arguments and static choices, expands supported variables and dynamic
content, then starts a macro run. Dynamic option scripts stay server-side; clients receive only
their returned choices.

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
| Extensions        | `/mcp`, `/plugin`, `/mini-app`, `/provider`  |

`/plugin` manages Claude Code plugins and their marketplaces; `/mini-app` lists, creates, switches
on and off, removes and reloads mini apps (see [Mini apps](mini-apps.md)).

### Native mini app hooks

Native hooks are callbacks returned by an enabled mini app's `register(ctx)` function.

| Hook                               | Primary effect                                                 | Boundary                                                                     |
| ---------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `onSessionStart`                   | Observe the first run of a session through the app's context.  | Fires once per session per API process and is not awaited.                   |
| `onUserMessage`                    | Rewrite the model-facing prompt.                               | The persisted user message does not change.                                  |
| `onPreToolCall`                    | Observe, rewrite, or block built-in, extension, and MCP calls. | A rewrite is schema-checked when the tool exposes a compatible schema.       |
| `onPostToolCall`                   | Replace result content or append a note.                       | Appended text is capped at 1,024 UTF-16 code units per hook result.          |
| `onAssistantMessage`               | Replace persisted assistant text or add message bindings.      | Content must be non-empty; bindings are validated and capped.                |
| `onSessionEnd`                     | Observe the end of each run.                                   | It is not a logical session-deletion event.                                  |
| `onSubagentStop`                   | Observe a child session reaching a terminal status.            | Observer-only.                                                               |
| `onHitlRequest` / `onHitlResolved` | Observe human-input request lifecycle.                         | These hooks cannot answer or veto the request.                               |
| `onHumanAssigned`                  | Observe a board card assigned to the person.                   | Receives `sessionId`, `messageId`, `from` and a text excerpt; observer-only. |

Native rewrites compose in mini app load order. Tool pre-hooks stop at the first block; post-hooks
all run and later hooks see earlier replacements.

Post-hooks also see execution errors converted into tool results; a pre-hook block skips execution
and post-hooks. Assistant hooks can add at most eight bindings in total, with an 8 MiB payload cap
per binding. These caps do not impose an aggregate limit on replacement message or tool text.

### Declarative hooks

Declarative hooks use the supported hooks JSON schema from enabled plugins or `hooks` frontmatter on
the invoked skill or delegated agent. Localix dispatches these events:

`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`,
`SessionEnd`, `SubagentStart`, `SubagentStop`, `PreCompact`, and `Notification`.

`PostToolUseFailure` runs in place of `PostToolUse` when a tool throws; its handlers receive the
error and can add context to the failed result. A plugin's hooks on any other event are listed in
its validation and never fire.

`PreCompact` fires with trigger `auto` before a [context checkpoint](context-checkpoints.md) is
committed. A block skips a proactive checkpoint, and the turn continues with the uncompacted view. A
block on a checkpoint that recovers from a context-limit error fails the turn. A checkpoint taken
only because the history does not fit the request is announced to `PreCompact` after it is taken,
and that call cannot block. After a checkpoint, the next run fires `SessionStart` with source
`compact`.

`SessionStart` fires on a session's first run in the API process. Its source is `startup` for a new
session, `fork` for a forked one, `resume` for a session that ran before the API last started, and
`clear` or `compact` after `/clear` or a checkpoint. In a run nobody is typing into, such as a
scheduled one, its `initialUserMessage` is the user turn before the run's prompt; with
`reloadSkills`, skills the hook installed are named to the agent and listed from the next run on.

`SessionEnd` fires when a session ends, not when a run ends. Deleting a session fires it with reason
`other`.

Matching handlers run in parallel, as in Claude Code, at most twelve `prompt` or `agent` handlers at
once. Each sees the same input, and their answers fold in declaration and plugin load order: a deny
from any `PreToolUse` handler stops the call without stopping the others from running, and the last
`updatedInput` or `PostToolUse` replacement declared is the one applied.

| Event                       | Effect of a blocking verdict                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `UserPromptSubmit`          | Rejects the prompt on any block.                                                                 |
| `PreToolUse`                | Stops the tool on any deny; `allow` and `ask` remain advisory.                                   |
| `PostToolUse`               | Cannot undo execution; a block reason becomes added result context.                              |
| `PostToolUseFailure`        | Cannot block; added context is appended to the failed result.                                    |
| `Stop`                      | Requests another run with the reason; eight in a row end the turn, and a tool call resets that.  |
| `Stop` `additionalContext`  | Requests the same bounded run as feedback, without a block.                                      |
| Scoped child `SubagentStop` | Can request the same bounded continuation in the child; parent observation does not restart it.  |
| `PreCompact`                | Skips a proactive checkpoint; fails a turn whose checkpoint recovers from a context-limit error. |
| Other lifecycle events      | Do not stop the run; context or observer effects depend on the event.                            |

A `command` or `http` handler with `"onFailure": "block"` turns its own failure into a block: when
it cannot start, exits with a code other than 0 or 2, times out, or answers with invalid output, the
event acts as on exit 2, and a `PermissionRequest` is denied. The error names the hook and says
`failed; blocking because onFailure is "block"`. `Stop`, `SubagentStop`, `TaskCompleted`,
`TeammateIdle` and background (`async`) handlers ignore the field.

### Tool calls

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

### Matcher, `if`, and `once`

Tool-event matchers accept engine names and compatible aliases such as `Bash`, including MCP name
forms. Empty, omitted, or `*` matchers match all. Simple names separated by `|` or commas compare
exactly, case included (`Bash`, not `bash`, is Claude Code's name); other patterns are unanchored
JavaScript regular expressions. Invalid regexes do not match. `UserPromptSubmit` and `Stop` ignore
group matchers; other lifecycle matchers inspect the event's source, reason, agent type,
notification type, or checkpoint trigger.

A matcher meets the Claude Code name of the call itself: a file listing is `Glob` and a content
search `Grep`, so a `Glob` matcher does not fire for a content search. `MultiEdit` matches an edit
with several replacements and `NotebookEdit` an edit of an `.ipynb` file.

A handler's `if` is one permission-style rule evaluated against the original tool input before
rewrites, read in Claude Code's shape. A Bash rule matches any command of a batch. A file rule
anchors as in Claude Code: `src/**` is the working directory's `src`, `//` the filesystem root and
`~/` your home folder. `Agent(Explore)`, `Skill(deploy)`, `WebFetch(domain:example.com)` and
`Tool(param:value)` read the agent type, the skill, the host and the named field. It applies only to
`PreToolUse`, `PostToolUse` and `PostToolUseFailure`; carrying it on another event prevents that
handler from running. Unparseable rules or unavailable comparison fields let the handler run. This
filter does not grant tool permission.

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

## Configuration

### Contribution locations

| Contribution             | Accepted source                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| Plugin slash command     | The default `commands/` tree, or `commands` paths or inline entries in `.claude-plugin/plugin.json` |
| Declarative plugin hooks | Default `hooks/hooks.json`, then `hooks` paths or inline objects in `.claude-plugin/plugin.json`    |
| Run-scoped hooks         | `hooks` frontmatter on the invoked skill or delegated agent                                         |
| Mini app slash command   | An entry under `commands` in `mini-app.json`, which carries its own `prompt`                        |
| Native mini app hooks    | `hooks` returned from the mini app's `register(ctx)` function                                       |

Inline commands win same-name collisions with command Markdown files. Explicit file/path entries win
over the default directory, and nested paths become colon-separated names. Paths listed in
`.claude-plugin/plugin.json` replace the default tree, as in Claude Code; a root `plugin.json` is
not read. Markdown commands need a non-empty body in a regular UTF-8 file up to 1 MiB. Discovery
considers at most 64 declared roots, eight directory levels, and 2,000 entries per scanned root, and
checks canonical paths against the plugin directory.

### Plugin command example and options

A command is a Markdown file in the plugin, `commands/review.md`:

```markdown
---
description: Review a change and report concrete findings.
arguments: [request]
---

Review the requested change and report concrete findings: $request
```

For a plugin named `team-tools`, it runs as `/team-tools:review <request>`, here and in Claude Code.

A mini app declares its commands in `mini-app.json`, each with its `prompt` and the chips and
pickers of its `args`; `${name}` takes each argument's value. In a mini app named `team-board` this
runs as `/team-board:review <request>`:

```json
{
  "commands": {
    "review": {
      "description": "Review a change and report concrete findings.",
      "prompt": "Review the requested change and report concrete findings: ${request}",
      "args": [{ "name": "request", "type": "text", "required": true }]
    }
  }
}
```

An options script runs directly through Bun when the composer requests choices for an enabled mini
app. It receives `{ query, cwd, sessionId, argName, command, config }` JSON on stdin and returns a
JSON array of strings or `{ value, label?, description? }` objects on stdout. Valid rows are
normalized, with at most 200 returned. The run has an eight-second deadline and a 256 KiB stdout
capture ceiling. A parse failure or timeout yields an empty menu; a non-zero exit alone does not
discard otherwise usable stdout.

The working directory is the resolved session directory, otherwise the project directory, otherwise
the shared Localix workspace. The script path must be lexically within the mini app's directory, but
this path check does not resolve symlink targets. This subprocess has normal local access and runs
outside Bash tool approval. Treat it as executable mini app code, rather than a sandboxed lookup.

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

A `prompt` or `agent` hook's `$ARGUMENTS` is replaced by the event JSON; without it, the JSON is
appended to the prompt. A backslash keeps a dollar sign literal (`\$1.00` reads `$1.00`).

A `command` handler's `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}`
are expanded by the shell from the child environment, not pasted into the command text, and a
non-secret `${user_config.KEY}` becomes `${CLAUDE_PLUGIN_OPTION_<KEY>}` with its value in the
environment. A project path or config value is therefore data even when it contains `$(…)`, quotes
or backticks. Quote the placeholder (`"${CLAUDE_PROJECT_DIR}"`) when the value may contain spaces.
Plugin monitor commands follow the same rule. An `http` handler's URL is not shell text, so its
placeholders are substituted directly.

Stdout counts as JSON output only when it is one JSON object with nothing around it. Text that does
not start with `{` or end with `}` is plain text; anything else that fails to parse is a
non-blocking error, applies nothing and never becomes context. On exit 2 a JSON object is still
read, and a deny or block reason in it replaces stderr as the message.

On `Stop`, `SubagentStop`, `TaskCompleted` and a plugin's `UserPromptSubmit`, exit 2 with empty
stdout and a stderr that says `No such file or directory` is a non-blocking error, so a hook whose
script is missing does not trap the agent. An `http` handler's 2xx body must be empty or a JSON
object; plain text is an error.

Command-hook stdout and stderr capture is capped at 64 KiB each. A hook's `additionalContext`,
`systemMessage` or plain stdout longer than 10,000 characters is saved to a file in the session's
folder and replaced by that file's path and its first 2,000 characters, as in Claude Code.

A command handler with `async: true` cannot affect the current event. When it exits 0, the
`additionalContext` and `systemMessage` of its JSON response reach the model with the session's next
turn; print the JSON alone on stdout or on a line of its own. `asyncRewake` can wake an idle session
when that command exits with code 2. That wake is armed when the hook starts and delivered at most
once; a hook that exits any other way, or is lost to an API restart, wakes nobody.

## Limits

- Declarative hooks enter through an enabled plugin, the invoked skill or agent's run-scoped
  frontmatter, and the `hooks` of your Claude Code settings files for the conversation's folder:
  `~/.claude/settings.json` and managed settings always, a project's `.claude/settings.json` and
  `.claude/settings.local.json` once you trusted the folder in Claude Code. `disableAllHooks` and
  `allowManagedHooksOnly` limit them, plugins' included, as in Claude Code.
- Enabling a hook-bearing plugin or mini app is a code-execution trust decision. Native and command
  hooks can run local code; HTTP hooks make network requests; MCP, prompt, and agent hooks invoke
  their named runtimes.
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
- A plugin, mini app or skill macro sent while a run is active waits in the queue as a whole command
  — its badge, model override, tool grants and hooks — and runs as its own turn.
- `/model` walks the model picker's steps in the composer — agent (groups only, with **All
  agents**), provider, model, then optional reasoning, turns and context limit settings — and never
  prints a model list. See [Switch models with `/model`](conversations.md#switch-models-with-model).
  Typed as `/model <name>`, it acts on one participant: the one named first (`/model @qa sonnet`),
  otherwise the participant your unaddressed message would go to.

## Related guides

- [Install Claude Code plugins](../extending/claude-code-plugins.md): what a Claude Code plugin runs
  in Localix
- [Your first session](../getting-started/first-session.md)
- [Build a mini app](../extending/mini-apps.md)
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
- [Dynamic option execution](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/arg-options.ts)
- [Native hook contracts](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/backend/hooks.ts)
- [Native hook dispatch](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/hooks.ts)
- [Native tool-hook composition and limits](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/hooks-tools.ts)
- [Native message hooks and bindings](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/hooks-messages.ts)
- [Native hook wait and isolation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/hook-invoke.ts)
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
