# 2048

This bundled mini app adds a 2048 board per chat. The person chooses **I play** or **Agent plays**
on the board. The person moves with the arrow keys or a swipe; the agent moves through `game_2048`,
playing a whole game in the turn the board hands it. Tiles travel from cell to cell, merges and new
tiles arrive once the slide lands, and a result card rises over the board when the game ends.

The structure is the one the other games share (see [`tic-tac-toe`](../tic-tac-toe/)): session
storage, routes for the view, one agent tool, a wake when the person hands over the board, and a
native workbench item.

| Path                      | What it holds                                                                 |
| ------------------------- | ----------------------------------------------------------------------------- |
| `shared/game.ts`          | The rules: a move, a list of moves played as one change, the recorded turn.   |
| `shared/describe.ts`      | The board as text for the agent: tool results, the wake, the message context. |
| `backend/game-service.ts` | The board at each chat, and every way it changes.                             |
| `backend/ask-agent.ts`    | The wake request that hands the board to the agent.                           |
| `backend/tools.ts`        | The agent's tool.                                                             |
| `ui/game/`                | The board, its geometry and tile tracking, the status and the result.         |
| `guide.md`                | How the agent plays and talks about a game.                                   |

A `game_2048` move carries a plan (`shared/play.ts`). With `prefer`, an order of directions, each
move takes the first direction that changes the board as it is then. With `moves`, an exact list, a
move that would not change the board is skipped. The agent cannot see the tile that spawns after
each move, so only the order can express the corner strategy. It declares `idempotentHint: false`,
so the host's repeat guard counts the same list as a repeat only when it also got the same answer.

State is kept with `openJsonStore` and announced by `createJsonStoreFeed`, both from
`@localixai/mini-app-sdk/backend`; the view reads it with `useTableGame` from
`@localixai/mini-app-sdk/ui/game-table`. A store write announces a change over the realtime feed,
and a visible board re-reads its snapshot. A healthy feed has no periodic read; when unavailable,
the board polls every 800 ms during agent activity or 4 seconds while idle. Showing the pane or
reconnecting reconciles its state.

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
