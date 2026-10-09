# Let an agent interact with a terminal

Localix agents can drive a live terminal through the `bash` tool: type text, press named keys, read
the rendered screen, and wait for screen content. The terminal pane remains available for you to
watch or take over. These actions are exposed when the run has a terminal host and `bash` access.
Permission rules still govern each call. Live and archived panes are confined to the calling user
and chat session; participants in the same chat share that terminal scope.

## Send input and observe the result

Use `action: "type"` for text and `keys: ["Enter"]` to submit it. Text and Enter are sent as
separate input bursts so a TUI does not treat Enter as part of a paste. Navigation sequences such as
`keys: ["Down", "Down", "Enter"]` run in order and return a fresh screen in the same call. Arrow
keys follow the application's cursor-key mode.

Calls contain only execution parameters; `bash` does not require a generated description label. For
example:

```json
{
  "action": "type",
  "terminal_id": "<id from the attached terminal or bash list>",
  "text": "/model",
  "keys": ["Enter"],
  "wait_for": "Select a model",
  "wait_timeout_ms": 15000
}
```

The text to wait for depends on the application. `wait_for` can accompany `open`, `type`, or `keys`,
or be used with `action: "wait"` on an existing terminal. `wait_absent: true` waits for that text to
disappear. A wait returns its outcome and the current screen; a timeout means the condition was not
observed within the deadline. Without a text condition, it waits for quiet output. Quiet output
alone does not prove that a task finished.

Match response or status text rather than text echoed from your own input. Matching is literal and
case-sensitive. Input results flag an unchanged display when the effect could not be confirmed.
Batch keystrokes whose order is already known and follow the application's on-screen shortcuts. When
the next choice depends on the application, inspect the returned screen first. For a model switch,
confirm the selected model in the screen before sending the next prompt. A typed command, an echoed
greeting, or an open picker does not prove that the selection or task succeeded.

When the program should finish after input, add `wait_for_exit: true` to `open`, `type`, or `keys`,
or use it with `action: "wait"`. This waits for process exit rather than quiet output and returns
the retained final screen. A timeout explicitly says the process is still running. Exit does not
prove success; inspect the final output. `wait_for_exit` cannot accompany `wait_for` or
`wait_absent`.

If a matched marker was already visible before input, the result warns that it does not confirm a
new response, even when another part of the screen changed. Choose a distinct response marker for
each request. See
[Drive an interactive program efficiently](../recipes/drive-interactive-terminal.md) for compound
calls that avoid unnecessary model round trips.

## Keep observations small and current

An attached terminal contributes a bounded rendered viewport rather than a history of TUI redraws. A
large viewport keeps both its beginning and end, with an explicit clipping notice;
`action: "screen"` returns the full viewport. Terminal snapshots supersede older observations of the
same terminal in the model's context, and job log reads supersede older reads of that job.

Automatic observations from `open`, `type`, `keys`, and `wait` keep at most 2,000 UTF-16 code units
of screen text, plus clipping notices. They retain the beginning and end, and an excerpt around a
`wait_for` match in the omitted middle when the marker fits within 500 code units. The complete
snapshot remains in the tool's structured details for the UI. Use `action: "screen"` when a decision
needs the omitted area; this reads the current viewport, not the entire output history.

Input actions already return a screen. Use `action: "wait"` for delayed output instead of repeatedly
calling `screen`. Waits wake on terminal output or exit, with a deadline, rather than rendering a
silent terminal on a timer. A retained final screen can be returned after exit and is labelled as
exited, so a fast response is not mistaken for missing output or a live process.

`jobs` manages background work and reads accumulated logs. Its PTY entries include the terminal id
for the `bash` interactive actions. The `until` parameter is a different mechanism: it polls a shell
condition and wakes the agent on success. Omit `action` for that mechanism; `action: "until"` is not
supported. See [Wait for something](monitors.md).

## Lifetimes and limits

| Surface          | Retention or limit                                                  | What it means                                                                           |
| ---------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Explicit wait    | 15 seconds by default; `wait_timeout_ms` accepts 100–120,000 ms     | Quiet output may return sooner; a deadline is not a task completion signal              |
| API scrollback   | Up to 262,144 UTF-16 code units per live terminal                   | Reconnection replays a retained tail, not all historical output                         |
| Post-exit screen | Up to 30 seconds, with 16 archived terminals across the API process | A later read can find no final screen, even when the process did exit                   |
| UI replay cache  | Up to 16 terminals, with 262,144 code units per terminal            | Kept in memory for tab remounts; terminal output is not persisted to disk by this cache |

A tab layout can survive a UI reload and reattach while its API-owned PTY is still alive. An API
restart does not restore that process or its in-memory scrollback. Retained output may remain in the
current UI while its replay cache survives. Relaunching an exited tab starts a new process with its
recorded command or a new shell; it does not resume the old one.

Closing a user-created terminal tab closes its PTY. Closing a tab adopted from an agent job or dev
server leaves that process with its launcher. Use `jobs stop` for running registered work, or
`bash action: "close"` for a terminal in this chat, when you intend to stop it.

## Related implementations

These projects provide useful examples of interactive terminal contracts:

- [terminal-use](https://github.com/flipbit03/terminal-use): a headless terminal with named keys and
  screen-content or stability waits.
- [Terminal-MCP](https://github.com/adsamcik/Terminal-MCP): compound input-and-wait operations,
  rendered observations, and application cursor-key handling.
- [libtmux-mcp](https://github.com/tmux-python/libtmux-mcp): ordered input batches and incremental
  capture with lifecycle and truncation checks.
- [interactive-shell-mcp](https://github.com/lightos/interactive-shell-mcp): separate stream and
  rendered-screen modes, idle waits, and screen regions.

Each observation stands on its own and replaces older observations of the same terminal. Incremental
screen diffs would require keeping their baseline across context trimming; that is not the current
contract.

## Source of truth

- [Action fields and wait limits](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/terminal/terminal-schema.ts)
- [Automatic observation cap](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/terminal/terminal-observation.ts)
- [Wait and post-exit behavior](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/terminal/terminal-wait.ts)
- [API final-screen archive](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/terminal/service.ts)
- [API scrollback retention](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/terminal/session-scrollback.ts)
- [Agent session ownership](https://github.com/rsaryev/localix/blob/main/apps/api/src/bootstrap/terminal-ports.ts)
- [UI replay cache](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/terminal/model/terminalOutput.ts)
- [Tab closing and reconnect](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/terminal/ui/TerminalPane.tsx)
- [Explicit relaunch](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/terminal/model/restartTerminalTab.ts)
