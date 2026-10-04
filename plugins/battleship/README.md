# Battleship

Battleship in the workbench, one game per chat, played against the agent in that chat. It has the
Tic-Tac-Toe plugin's shape — a person's shot wakes the chat through the host's wake contract, and
the agent answers with the plugin's own tool — plus the one thing the other games do not have:
hidden information.

## How a game goes

1. Both fleets are placed at random when a game starts; before the first shot you may place yours
   anew. You fire on the agent's waters by clicking a cell.
2. A hit earns another shot. A miss passes the turn: the board asks the host to wake the chat it
   belongs to, with the agent's side of the game and the tools that answer it (`ctx.host.wake`).
3. The agent calls `battleship` with action `fire`. After a hit it fires again; its miss ends its
   turn — the board shows the shot, so no chat line is needed. When a fleet is sunk, the result
   appears over the boards, and the agent's whole fleet is shown.

The first shot alternates from game to game, and the table keeps the score. If the chat cannot take
the turn, the board says so and offers to ask again.

## One game per chat

The board is a session-scoped work item: each chat has its own, opening it from another chat opens
that chat's, and deleting the chat closes it. The game lives in the chat's session storage
(`ctx.sessionStorage`), which the host removes with the chat. Every route and tool acts on the chat
it belongs to: `c.env.sessionId` in a route (set only once the host checked the user owns it), the
call's own session in a tool.

## What each side sees

The whole game — both fleets — exists only on the server. Nothing leaves it unprojected:

| Reader               | Gets                                              | Built by                 |
| -------------------- | ------------------------------------------------- | ------------------------ |
| The view (routes)    | Your fleet; of the agent's, only what you sank    | `viewFor(game, 'you')`   |
| The agent (tools)    | Its own fleet; its shots at yours and the results | `viewFor(game, 'agent')` |
| The agent (wake)     | The same, as the message that asks for its shot   | `askForShot`             |
| The agent (chat box) | The shots and the score, never your fleet         | `describeForChat`        |

Once a game is over, both fleets are shown to both sides.

## The agent's tool

One tool, `battleship`: every schema rides in every request, so one tool with an `action` costs less
than three and leaves the model one name to choose.

| `action`   | Does                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| `fire`     | Fires at one `cell` "A1"–"J10" on the user's board, only on its turn.  |
| `state`    | Reads the agent's side: its shots, its fleet, whose turn, the score.   |
| `new_game` | Starts the next game at this chat's table and opens the board for you. |

It never wakes the chat: a tool call is already the agent's turn. When a game ends, the result asks
the agent to keep anything it learned about how you play in its memory, where it outlives the chat.

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
| `skills/`                 | How the agent plays and talks about a game.                      |

`backend/store.ts`, `backend/store-feed.ts`, `shared/store-feed.ts`, `ui/usePolledSnapshot.ts`,
`ui/useStoreSnapshot.ts` and `ui/useNow.ts` are the reference template's frame, kept as they are.
The store feed is how the agent's shot reaches an open board: every write to the chat's game nudges
the board over the realtime socket, and it re-reads its view at once (the frame carries no state, so
the agent's fleet still never reaches the browser). The board polls only as a backstop — every 30
seconds while the feed is live, and at its old 800 ms / 4 s cadence while it is not.

See [Wake a session from a plugin](../../docs/extending/plugin-wakes.md) for the contract.
