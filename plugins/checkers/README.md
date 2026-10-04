# Checkers

A checkers board (Russian draughts) in the workbench, one per chat, played against the agent in that
chat. It follows the Tic-Tac-Toe plugin's shape: a move on the board wakes the chat through the
host's wake contract, and the agent answers with the plugin's own tool.

## How a game goes

1. You move on the board: click a piece, then each square it lands on. The board asks the host to
   wake the chat it belongs to, with the position, the legal moves and the tools that answer it
   (`ctx.host.wake`).
2. The host puts the `checkers` tool on that chat's wire and starts a turn, marked "via Plugin" in
   the transcript.
3. The agent calls `checkers` with action `move` and one of the legal moves. While the game goes on
   that move ends its turn — the board shows it, so no chat line is needed. When a game ends, the
   result appears over the board.

White moves first, and your colour alternates from game to game, so the agent opens every other
game; the table keeps the score. The board is always drawn from your side.

When the chat cannot take the turn, the board says so and offers to ask again. If the board cannot
load, **Try again** retries the read without reopening the workbench.

## One board per chat

The board is a session-scoped work item: each chat has its own, opening it from another chat opens
that chat's, and deleting the chat closes it. The game lives in the chat's session storage
(`ctx.sessionStorage`), which the host removes with the chat. Every route and tool acts on the chat
the board belongs to — `c.env.sessionId` in a route (set only once the host checked the user owns
it), the call's own session in a tool — so switching chats never moves a game, and an agent never
plays another chat's board. When a game ends, the result asks the agent to keep anything it learned
about how you play in its memory, where it outlives the chat.

## Rules

Russian draughts on the 32 dark squares of an 8×8 board:

- A capture is compulsory, and a capture that can go on must go on; among captures, any may be
  chosen.
- Men step forward one square and capture in all four directions.
- Kings move and capture any distance along a free diagonal; when some landings let a capture go on,
  the king must take one of those.
- A man that reaches the far row mid-capture is crowned and carries on as a king.
- Captured pieces leave the board only when the move ends, so none is jumped twice.
- A side with no move left loses; fifteen moves each with no capture and no man moved is a draw.

## The agent's tool

One tool, `checkers`: every schema rides in every request, so one tool with an `action` costs less
than four and leaves the model one name to choose.

| `action`   | Does                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| `move`     | Plays one legal move in notation ("c3-d4", "c3:e5:g3"), on its turn.   |
| `state`    | Reads the position, whose turn it is and the legal moves.              |
| `new_game` | Starts the next game at this chat's table and opens the board for you. |
| `resign`   | Gives up a game the agent judges lost; you win.                        |

It never wakes the chat: a tool call is already the agent's turn, and a tool that woke the agent
would wake it again on every move.

## Layout

| Location                  | Responsibility                                                 |
| ------------------------- | -------------------------------------------------------------- |
| `shared/rules.ts`         | The rules: legal moves, captures, crowning.                    |
| `shared/game.ts`          | The contract and the one function that plays a move.           |
| `shared/notation.ts`      | Squares and moves as text ("c3", "c3:e5:g3"), and the parser.  |
| `shared/resource.ts`      | The board's URI — bare, or naming its chat.                    |
| `shared/describe.ts`      | The game as text for the agent.                                |
| `backend/game-service.ts` | Every change to the game, and when the agent is asked to move. |
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
