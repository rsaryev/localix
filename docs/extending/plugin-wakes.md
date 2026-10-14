# Wake a session from a plugin

A plugin can start a turn in a chat session when something happens that the agent should act on — a
person moves in the plugin's view, or a condition the plugin watches comes true. The agent answers
through the plugin's own tools. The bundled Tic-Tac-Toe plugin is the reference: each chat has its
own board, a move on it wakes that chat, and the agent replies through the plugin's one tool,
`tic_tac_toe`, with action `move`. A single tool with action dispatch keeps the plugin's callable
surface compact. The other bundled games have the same shape:

- **Checkers** has a larger move. Its wake lists the legal moves, and the agent answers with one of
  them through `checkers`; it can also resign a lost game.
- **Battleship** has hidden information. During play its wake uses the agent's view and hides the
  user's fleet; completed games reveal both fleets.
- **Chess** takes its rules from a library, behind one module. Its wake lists the legal moves in SAN
  with the FEN, and the agent answers through `chess`; it can also resign a lost game.

## Terminology

| Term         | Meaning                                                        | Boundary                                                 |
| ------------ | -------------------------------------------------------------- | -------------------------------------------------------- |
| Wake         | One turn a plugin asks for, through `ctx.host.wake`.           | Available on the backend load only, where routes live.   |
| Answer tools | The plugin's own tools the woken turn answers with.            | Only tools this plugin registered; any other is refused. |
| Key          | A name that makes a repeated wake the same delivery.           | Joins a wake still waiting for its turn; not a receipt.  |
| Outcome      | Queue admission: `delivered`, `missed`, `refused` or `failed`. | A delivered wake is not proof of an agent answer.        |

## What you can do

| Task                                    | Mechanism                                                                                                                                            | Boundary                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Wake the chat your view belongs to      | The view sends `?sessionId=` from `useWorkItemSessionId()`; the route calls `ctx.host.wake({ userId: c.env.userId, sessionId: c.env.sessionId, … })` | Wake-only: a plugin cannot read the session.                                           |
| Name the tools that answer the event    | `tools: ['my_tool']` on the request                                                                                                                  | At most six distinct names; the plugin's eligible tools are considered for activation. |
| Make a double click one wake            | `key: '<something stable for this event>'`                                                                                                           | Letters, digits and `.:_-`, up to 120 characters.                                      |
| Decide what happens when nobody answers | Read the outcome                                                                                                                                     | `missed`: no such chat; `refused`: the request broke the contract.                     |
| End the agent's turn after its answer   | Return `terminate: true` from the answering tool                                                                                                     | Only when the result speaks for itself (the board shows the move).                     |
| Point a manifest monitor at a chat      | `ctx.host.monitors.arm({ userId, sessionId, monitor })`; `disarm` with the same request                                                              | Own monitors, owned sessions only; an unarmed line wakes no one.                       |

## How it works

1. The route calls `ctx.host.wake({ userId, sessionId, message, tools, key })`. The host checks the
   request: a nonempty trimmed message of at most 2,000 UTF-16 code units, a well-formed key, and
   only tools this plugin registered on its latest load.
2. The host frames the message with a line saying which plugin sent it, that the person did not type
   it, and which tools answer it, then hands it to the one wake delivery with the source `plugin`.
   The transcript marks the turn "via Plugin".
3. The wake's row names the plugin. The run considers its registered tools for initial activation,
   subject to the agent's policy and host/model support. The request's `tools` list names answer
   tools for validation and framing; it does not restrict the run to that subset. Surface activation
   is not saved as the session's explicit tool activation.
4. The call answers the outcome. The plugin records it — Tic-Tac-Toe shows "thinking" or the reason
   — so a view never waits for an answer nobody was asked for.

`c.env.sessionId` reaches the route only once the host has checked that the user owns the session. A
request naming a foreign or deleted chat arrives without it, so a route that needs a chat refuses it
before touching any data.

Wake for events the agent did not cause. A plugin tool must never wake the session: the agent's call
would wake the agent, whose next call would wake it again.

`delivered` means the host admitted the wake, including while another run is busy. It does not wait
for the agent to execute an answer tool or verify its result. Track the operation's own state and
handle a failed or refused wake separately; the host does not automatically retry delivery.

Tools from an open plugin tab come from the latest message the person sent. Closing the tab or
removing its context chip changes that contribution on the next message, rather than immediately
changing an active run. Explicitly activated tools have their own lifetime; see
[tool budget and controls](../features/tool-budget.md).

## Limits

- The key joins a wake that is still queued; after its turn ran, the same key is a new delivery. Use
  a distinct key per event, rather than treating it as a permanent completion receipt.
- A plugin loaded in several scopes owns the union of its tools there.
- A wake without a `sessionId` cannot be delivered; a view that belongs to no chat should say so.

## Related guides

- [Build plugins](plugins.md)
- [Build workbench UI](plugin-ui.md)

## Source of truth

- [The SDK contract](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/backend/host-services.ts)
- [The host side](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/plugin-wake.ts)
- [Delivery outcomes](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/triggers/delivery.ts)
- [Initial tool activation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/tool-deferral.ts)
- [Tools a wake or an open tab brings](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/surface-tools.ts)
- [The reference plugin](https://github.com/rsaryev/localix/tree/main/plugins/tic-tac-toe)
- [Checkers, the same shape with multi-square moves](https://github.com/rsaryev/localix/tree/main/plugins/checkers)
- [Battleship, the same shape with hidden information](https://github.com/rsaryev/localix/tree/main/plugins/battleship)
- [Chess, the same shape with a rules library behind one module](https://github.com/rsaryev/localix/tree/main/plugins/chess)
