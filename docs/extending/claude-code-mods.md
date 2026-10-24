# Run Claude Code mods

A mod is a Claude Code plugin with a hooks module: functions Localix calls as a conversation runs,
which can open panes, draw above the message box and react to what the agent does. Localix runs mods
written for Claude Code unchanged. Use this page to see how a mod runs in Localix and what it can
and cannot do here; [Claude Code compatibility](claude-code-compatibility.md) lists every area.

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
Each call is also an event the other mods of the project can hook, with Claude Code's input for it
(`$.fs.read('a.md')` reaches a hook as `{ path, as }`); a hook answers `{ value }` in the call's
place or `{ deny }`, which rejects the caller's promise. The synchronous calls fire their events
too, without waiting. An `engine.create` step adds nouns of its own (`$.telemetry`) to every mod's
`$`. Hooks run in the plugins' order in every project, and `next` carries `signal`, `origin`,
`budget`, `event`, `is(pattern, e)` and `trace`.

| Part of `$`                                                                                      | In Localix                                                                                                     |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `$.tool.call`, `list`, `check`, `register`; `$.mcp.call`                                         | The running turn's tools under Claude Code's names (`Bash`, `Edit`, `mcp__<server>__<tool>` …)                 |
| `$.command.register`, `run`, `list`                                                              | `/<name>` or `/<plugin>:<name>`, answered by the project's instance; `list` adds Localix's commands and skills |
| `$.agent.spawn`, `list`, `register`                                                              | A delegated child task of the chat; `register` defines `<plugin>:<name>`                                       |
| `$.model.complete`, `fork`, `classify`                                                           | One completion on the chat's model; a question after the conversation, with its system prompt                  |
| `$.session.*`, `$.turn.abort`                                                                    | The chat's transcript, model, usage, repository and checkpoint; stop the turn                                  |
| `$.prompt.submit`, `fill`, `suggest`, `compose`, `read`                                          | A new turn; the message box's draft and its ghost suggestion (Tab); the system prompt's sections               |
| `$.ui.open`, `close`, `panes`, `status`, `ask`, `toast`, `log`, `copy`                           | Panes in the **Mods** view; the status line under the message box; a question card; notices                    |
| `$.store`, `$.fs`, `$.http`, `$.process`, `$.env`, `$.clock`, `$.settings`                       | Supported; files resolve from the project's folder; settings from Claude Code's settings files                 |
| `$.audio.speak`, `play`                                                                          | The system's voice and player                                                                                  |
| `$.config`                                                                                       | No rows: Localix keeps its settings elsewhere                                                                  |
| `$.ui.scroll`, `focus`, `view`, `blit`                                                           | Answer `{ deny }`: Localix scrolls, focuses and switches views as the person does; no raster                   |
| `$.ui.notify`, `selection`; `$.session.identity`, `send`; `$.mcp.connect`; `$.process.spawn`     | Claude Code's refusal: no notification channel or selection on the desktop, no Claude account                  |
| Elements `Box`, `Text`, `Button`, `Link`, `Code`, `Markdown`, `Input`, `Select`, `Svg`, `Client` | Drawn with Localix controls; a `Client` runs its surface module in an isolated frame                           |

## The band above the message box

A mod draws in the band above a chat's message box with `ui.render` for
`{ component: 'AbovePrompt' }`, as in Claude Code's terminal and desktop app. `e.props` carries
`hasSurvey`, `isWorking`, `maxRows`, `bodyColumns`, `scroll` and `view`; the mods of the chat's
project compose it, `next(e)` giving what the mods after one drew. The band's Buttons press by their
`hotkey` while the band has focus, and a digit typed alone into the empty message box presses the
band's Button on that digit after a pause. The mark at the band's right end collapses it to one row,
where no hotkey presses. A press, a typed value or a pick runs in the chat, so `$.prompt.fill` puts
text in its message box.

A pane opened with `$.ui.open({ focus: true })` opens the **Mods** view on it and takes the
keyboard, starting at its `autoFocus` control, and answers `{ isPlaced: true }`; one opened without
`focus` waits in the view's list and answers `{ isPlaced: false, reason }`. A pane's Buttons press
by `hotkey` while it has focus, and `closeOnEscape` closes it on Escape. Its events run in the chat
that opened it.

A Button without a `key` is addressed by its label, else its one string child, and draws its
children as its label; `plain`, `variant`, `dimColor` and `hotkey` show as Localix draws a button
and its key. Text and Box take Claude Code's colours (as the theme's), `inverse`, `strikethrough`,
`size`, per-side spacing and sizes in cells; Input takes `rows` and `label`, Select `label`.

Localix fires the engine's events at these points. `prompt.submit`, `turn.start`, `turn.step` and
`turn.complete` frame each turn; `turn.step` can resend a model request on another model or effort.
`tool.call` wraps every tool call and `tool.check` reviews its permission. `tool.describe`,
`prompt.section`, `prompt.compose`, `prompt.context`, `prompt.attachment` and `attribution.text`
shape what the model reads, kept per conversation until `$.ui.invalidate(event)` so the prompt cache
stays warm. `tool.call` resolves to the tool's own record in Claude Code's shape (Bash's `stdout`,
Write's file record) with `text` and a `ref`; a call that edits or writes several files is one
`tool.call` per file with an absolute `file_path`, and a hook's `context` lines reach the model
after the result.

When a turn stops, the hold a hook keeps on a call is abandoned: `next.signal` aborts and the call
does not run. `turn.complete` says `answer`, `aborted` or `error`, with the turn's `usage`, from a
stopped or failed turn too. A delegated child's turn and tool events carry its `agentId`.

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

## Not yet in Localix

- Render sites other than `Pane` and `AbovePrompt` (`Spinner`, `PromptHint`, `SessionMode`,
  `UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `CommandOutput`,
  `AskUserQuestion`, `InfoNotice`, `TurnDuration`): Localix draws those parts of a chat itself, and
  a `ui.render` hook on them is not asked.
- `classic.*` events: Claude Code hooks from settings and plugins run in Localix's own hook runner,
  which mods do not wrap.
- The message box's events (`prompt.edit`, `prompt.autocomplete`, `prompt.mention`) are not raised,
  and `$.prompt.read` answers an empty draft, as Claude Code does where no box is mounted.
- `ui.focus` and `ui.scroll` are not raised; `$.config` lists no rows; a band press names the first
  mod of the chat's project as its `plugin`; `$.ui.toast` ignores `timeoutMs`.
- `session.end` names no session: a mod's instance serves every chat of its project.
- `$.session.append` keeps text rows only, and a command a mod answers with `{}` still shows a line.
- The `claude-code/testing` kit and `claude plugin test` are not part of Localix.
- `turn.complete` never says `refusal`: Localix's providers report none.

## Related guides

- [Claude Code plugins](claude-code-plugins.md)
- [Claude Code compatibility](claude-code-compatibility.md)
- [Hooks and commands](../features/hooks-and-commands.md)

## Source of truth

- [Mods host](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mods/host.ts)
- [Parity tool](https://github.com/rsaryev/localix/blob/main/scripts/cc-parity/README.md)
