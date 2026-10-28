# Chess

A chess board in the workbench, one per chat, played against the agent in that chat. It follows the
Checkers mini app's shape: a move on the board wakes the chat through the host's wake contract, and
the agent answers with the mini app's own tool.

## How a game goes

1. You move on the board: click a piece, then the square it goes to. A pawn reaching the last rank
   asks which piece it becomes. The board asks the host to wake the chat it belongs to, with the
   position, the FEN, the legal moves and the tools that answer it (`ctx.host.wake`).
2. The host puts the `chess` tool on that chat's wire and starts a turn, marked "via Mini app" in
   the transcript.
3. The agent calls `chess` with action `move` and one of the legal moves, in SAN. While the game
   goes on that move ends its turn — the board shows it, so no chat line is needed. When a game
   ends, the result appears over the board.

White moves first, and your colour alternates from game to game; the table keeps the score. The
board is always drawn from your side. When the chat cannot take the turn, the board says so and
offers to ask again.

## Rules

Every rule comes from [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause), behind one
module, `shared/position.ts`: legal moves with castling, en passant and promotion; check and
checkmate; draws by stalemate, threefold repetition, the fifty-move rule and insufficient material.
The position is replayed from the moves played, never trusted from a stored FEN, because threefold
repetition is decided on the history.

## One board per chat

The board is a session-scoped work item: each chat has its own, opening it from another chat opens
that chat's, and deleting the chat closes it. The game lives in the chat's session storage
(`ctx.sessionStorage`), which the host removes with the chat. Every route and tool acts on the chat
the board belongs to — `c.env.sessionId` in a route (set only once the host checked the user owns
it), the call's own session in a tool. When a game ends, the result asks the agent to save
observations about play in its memory, where the agent has one. Whether it can write there depends
on its permission rules.

## The agent's tool

One tool, `chess`, groups its operations under `action`. Its schema is deferred until activated or
brought onto the request by linked game context or a mini app wake.

| `action`   | Does                                                              |
| ---------- | ----------------------------------------------------------------- |
| `move`     | Plays one legal move in SAN ("Nf3", "O-O", "e8=Q"), on its turn.  |
| `state`    | Reads the position, the FEN, the moves, whose turn and the score. |
| `new_game` | Starts the next game at this chat's table and offers its board.   |
| `resign`   | Gives up a game the agent judges lost; you win.                   |

## Layout

| Location                  | Responsibility                                                 |
| ------------------------- | -------------------------------------------------------------- |
| `shared/position.ts`      | The one door to chess.js: positions, legal moves, how it ends. |
| `shared/game.ts`          | The contract and the one function that plays a move.           |
| `shared/describe.ts`      | The game as text for the agent.                                |
| `shared/resource.ts`      | The board's URI — bare, or naming its chat.                    |
| `backend/game-service.ts` | Every change to a chat's game, and when the agent is asked.    |
| `backend/ask-agent.ts`    | The wake request: the position, the answering tools, the key.  |
| `backend/routes.ts`       | The board's routes; each answers with the new game.            |
| `backend/tools.ts`        | The agent's tools.                                             |
| `ui/`                     | The board, the move being built, the turn line and the result. |
| `guide.md`                | How the agent plays and talks about a game.                    |

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
