# Battleship

Battleship in the workbench, one game per chat, played against the agent in that chat. It has the
Tic-Tac-Toe mini app's shape — a person's shot wakes the chat through the host's wake contract, and
the agent answers with the mini app's own tool — plus the one thing the other games do not have:
hidden information.

## How a game goes

1. Both fleets are placed at random when a game starts; before the first shot you may place yours
   anew. You fire on the agent's waters by clicking a cell.
2. A hit earns another shot. A miss passes the turn: the board asks the host to wake the chat it
   belongs to, with the agent's side of the game and the tools that answer it (`ctx.host.wake`).
3. The agent calls `battleship` with action `fire`. After a hit it fires again; its miss ends its
   turn — the board shows the shot, so no chat line is needed. When a fleet is sunk, the result
   appears over the boards, and the agent's whole fleet is shown.

The board's **New game** action alternates who fires first when no starter is specified. The agent's
`new_game` tool defaults to the user, or accepts `first: "agent"`. The table keeps the score. If the
chat cannot take the turn, the board says so and offers to ask again.

## One game per chat

The board is a session-scoped work item: each chat has its own, opening it from another chat opens
that chat's, and deleting the chat closes it. The game lives in the chat's session storage
(`ctx.sessionStorage`), which the host removes with the chat. Every route and tool acts on the chat
it belongs to: `c.env.sessionId` in a route (set only once the host checked the user owns it), the
call's own session in a tool.

## What each side sees

The whole game — both fleets — exists only on the server. Nothing leaves it unprojected:

| Reader               | Gets                                                        | Built by                 |
| -------------------- | ----------------------------------------------------------- | ------------------------ |
| The view (routes)    | Your fleet; of the agent's, only what you sank              | `viewFor(game, 'you')`   |
| The agent (tools)    | Its own fleet; its shots at yours and the results           | `viewFor(game, 'agent')` |
| The agent (wake)     | Its target grid, recent shots, score and aiming suggestions | `askForShot`             |
| The agent (chat box) | The shots and the score, never your fleet                   | `describeForChat`        |

Once a game is over, both fleets are shown to both sides.

## The agent's tool

One tool, `battleship`, groups its operations under `action`. Its schema is deferred until activated
or brought onto the request by linked game context or a mini app wake.

| `action`   | Does                                                                  |
| ---------- | --------------------------------------------------------------------- |
| `fire`     | Fires at one `cell` "A1"–"J10" on the user's board, only on its turn. |
| `state`    | Reads the agent's side: its shots, its fleet, whose turn, the score.  |
| `new_game` | Starts the next game at this chat's table and offers its board.       |

It never wakes the chat: a tool call is already the agent's turn. When a game ends, the result asks
the agent to save observations in its memory, where the agent has one. Whether it can write there
depends on its permission rules.

Use either a top-level `action` or an `actions` array of 1–16 steps. A batch stops when the turn
passes to the user, the game ends, or a step is refused. Earlier changes remain applied; after a
later refusal the result reports the completed count and the unplayed step without marking the whole
call as an error. A refusal before any completed step returns `isError: true` and the current agent
view. A miss ends the model turn only when it answers a pending board wake; a shot requested
directly in chat can retain the agent's reply.

## Layout

| Location                  | Responsibility                                                   |
| ------------------------- | ---------------------------------------------------------------- |
| `shared/rules.ts`         | The rules: the fleet, placement, shots, what a shooter knows.    |
| `shared/game.ts`          | The contract, the one function that fires, and each side's view. |
| `shared/describe.ts`      | The game as text for the agent, from its side only.              |
| `backend/game-service.ts` | Every change to a chat's game, and when the agent is asked.      |
| `backend/ask-agent.ts`    | The wake request: the agent's view, the answering tools, a key.  |
| `backend/routes.ts`       | The board's routes; each answers with the person's view.         |
| `backend/tools.ts`        | The agent's tools.                                               |
| `ui/`                     | The two boards, the turn line and the result.                    |
| `guide.md`                | How the agent plays and talks about a game.                      |

State is kept with `openJsonStore` and announced by `createJsonStoreFeed`, both from
`@localixai/mini-app-sdk/backend`; the view reads it with `useTableGame` from
`@localixai/mini-app-sdk/ui/game-table`. A store write announces a change over the realtime feed,
and a visible board re-reads its snapshot. A healthy feed has no periodic read; when unavailable,
the board polls every 800 ms during agent activity or 4 seconds while idle. Showing the pane or
reconnecting reconciles its state.

The stream frame carries no fleet state; the route projects the player’s view and reveals the
opponent fleet only when the game ends.

See [Wake a session from a mini app](../../docs/extending/mini-app-wakes.md) for the contract.

## Permissions and synchronization

The tool classifies `state` as `read` and game-changing actions as `session`. Its static
`mutates: true` flag therefore does not make every action an external mutation. Agent rules and
conversation permission modes still apply.

## Source of truth

- [Mini app manifest](mini-app.json) and [agent guide](guide.md)
- [Tool actions and effect classification](backend/tools.ts)
- [Game state and transitions](shared/game.ts)
- [Wake requests](backend/ask-agent.ts)
- [Visible snapshot and fallback cadence](ui/game/useGame.ts)
- [Shared store synchronization](../../packages/mini-app-sdk/src/ui/store-snapshot.ts)
