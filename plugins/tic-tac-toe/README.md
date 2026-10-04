# Tic-Tac-Toe

A tic-tac-toe board in the workbench, one per chat, played against the agent in that chat. It is the
first plugin that uses the host's wake contract: a move on the board starts a turn in the chat, and
the agent answers with the plugin's own tool.

## How a game goes

1. You play X on the board. The board asks the host to wake the chat it belongs to, with the
   position and the tools that answer it (`ctx.host.wake`).
2. The host puts the `tic_tac_toe` tool on that chat's wire and starts a turn, marked "via Plugin"
   in the transcript.
3. The agent calls `tic_tac_toe` with action `move`. While the game goes on that move ends its turn
   — the board shows it, so no chat line is needed. When a game ends, the result appears over the
   board.

Who opens alternates from game to game, and the table keeps the score. When the chat cannot take the
turn, the board says so and offers to ask again. If the board cannot load, **Try again** retries the
read without reopening the workbench.

## One board per chat

The board is a session-scoped work item: each chat has its own, opening it from another chat opens
that chat's, and deleting the chat closes it. The game lives in the chat's session storage
(`ctx.sessionStorage`), which the host removes with the chat. Every route and tool acts on the chat
the board belongs to — `c.env.sessionId` in a route (set only once the host checked the user owns
it), the call's own session in a tool — so switching chats never moves a game, and an agent never
plays another chat's board.

## The agent's tool

One tool, `tic_tac_toe`: every schema rides in every request, so one tool with an `action` costs
less than three and leaves the model one name to choose.

| `action`   | Does                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| `move`     | Plays O at a `cell` 1–9, only on the agent's turn.                     |
| `state`    | Reads the position, whose turn it is, the free cells and the score.    |
| `new_game` | Starts the next game at this chat's table and opens the board for you. |

It never wakes the chat: a tool call is already the agent's turn, and a tool that woke the agent
would wake it again on every move. When a game ends, the result asks the agent to keep anything it
learned about how you play in its memory, where it outlives the chat.

## Layout

| Location                  | Responsibility                                                |
| ------------------------- | ------------------------------------------------------------- |
| `shared/game.ts`          | The contract and the rules: moves, wins, draws, the score.    |
| `shared/describe.ts`      | The game as text for the agent.                               |
| `shared/resource.ts`      | The board's URI — bare, or naming its chat.                   |
| `backend/game-service.ts` | Every change to a chat's game, and when the agent is asked.   |
| `backend/ask-agent.ts`    | The wake request: the position, the answering tools, the key. |
| `backend/routes.ts`       | The board's routes; each answers with the new game.           |
| `backend/tools.ts`        | The agent's tools.                                            |
| `ui/`                     | The board, the turn line and the result card.                 |
| `skills/`                 | How the agent plays and talks about a game.                   |

`backend/store.ts`, `backend/store-feed.ts`, `shared/store-feed.ts`, `ui/usePolledSnapshot.ts`,
`ui/useStoreSnapshot.ts` and `ui/useNow.ts` are the reference template's frame, kept as they are.
The store feed is how the agent's move reaches an open board: every write to the chat's game nudges
the board over the realtime socket, and it re-reads at once. The board polls only as a backstop —
every 30 seconds while the feed is live, and at its old 800 ms / 4 s cadence while it is not.

See [Wake a session from a plugin](../../docs/extending/plugin-wakes.md) for the contract.
