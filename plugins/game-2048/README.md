# 2048

This bundled plugin adds a 2048 board per chat. The person chooses **I play** or **Agent plays** on
the board. The person moves with the arrow keys or a swipe; the agent moves through `game_2048`,
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
| `skills/`                 | How the agent plays and talks about a game.                                   |

A `game_2048` move carries a plan (`shared/play.ts`). With `prefer`, an order of directions, each
move takes the first direction that changes the board as it is then. With `moves`, an exact list, a
move that would not change the board is skipped. The agent cannot see the tile that spawns after
each move, so only the order can express the corner strategy. It declares `idempotentHint: false`,
so the host's repeat guard counts the same list as a repeat only when it also got the same answer.

`backend/store.ts`, `backend/store-feed.ts`, `shared/store-feed.ts`, `ui/usePolledSnapshot.ts`,
`ui/useStoreSnapshot.ts` and `ui/useNow.ts` are the reference template's frame, kept as they are
(`scripts/plugin-frame-copies.test.ts` checks it). The store feed is how the agent's moves reach an
open board: every write to the chat's game nudges the board over the realtime socket, and it
re-reads at once. The board polls only as a backstop — every 30 seconds while the feed is live, and
at its old 800 ms / 4 s cadence while it is not.

See [Wake a session from a plugin](../../docs/extending/plugin-wakes.md) for the contract.
