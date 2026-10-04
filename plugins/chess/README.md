# Chess

A chess board in the workbench, one per chat, played against the agent in that chat. It follows the
Checkers plugin's shape: a move on the board wakes the chat through the host's wake contract, and
the agent answers with the plugin's own tool.

## How a game goes

1. You move on the board: click a piece, then the square it goes to. A pawn reaching the last rank
   asks which piece it becomes. The board asks the host to wake the chat it belongs to, with the
   position, the FEN, the legal moves and the tools that answer it (`ctx.host.wake`).
2. The host puts the `chess` tool on that chat's wire and starts a turn, marked "via Plugin" in the
   transcript.
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
it), the call's own session in a tool. When a game ends, the result asks the agent to keep anything
it learned about how you play in its memory, where it outlives the chat.

## The agent's tool

One tool, `chess`: every schema rides in every request, so one tool with an `action` costs less than
four and leaves the model one name to choose.

| `action`   | Does                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| `move`     | Plays one legal move in SAN ("Nf3", "O-O", "e8=Q"), on its turn.       |
| `state`    | Reads the position, the FEN, the moves, whose turn and the score.      |
| `new_game` | Starts the next game at this chat's table and opens the board for you. |
| `resign`   | Gives up a game the agent judges lost; you win.                        |

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
| `skills/`                 | How the agent plays and talks about a game.                    |

`backend/store.ts`, `backend/store-feed.ts`, `shared/store-feed.ts`, `ui/usePolledSnapshot.ts`,
`ui/useStoreSnapshot.ts` and `ui/useNow.ts` are the reference template's frame, kept as they are.
The store feed is how the agent's move reaches an open board: every write to the chat's game nudges
the board over the realtime socket, and it re-reads at once. The board polls only as a backstop —
every 30 seconds while the feed is live, and at its old 800 ms / 4 s cadence while it is not.

See [Wake a session from a plugin](../../docs/extending/plugin-wakes.md) for the contract.
