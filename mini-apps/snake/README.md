# Snake

This bundled mini app adds a Snake board per chat. The person chooses **I play** or **Model plays**.
The person steers with the arrow keys or a swipe; the decision model is asked by the board itself,
one move at a time. There is no chat-agent player: the agent's `snake` tool only reads the board and
starts a game.

| Path                      | What it holds                                                              |
| ------------------------- | -------------------------------------------------------------------------- |
| `shared/game.ts`          | The rules: one tick, the seeded food, look-ahead and flood fill.           |
| `shared/describe.ts`      | The board as text for the agent: tool results and the message context.     |
| `backend/game-service.ts` | The board at each chat, the replay of the person's turns, the model's run. |
| `backend/ask-decision.ts` | The one question the decision model is asked per move.                     |
| `backend/tools.ts`        | The agent's read-only tool.                                                |
| `ui/game/useHumanRun.ts`  | The person's game, played in the view and saved in batches.                |
| `ui/game/`                | The board, the status, Stop and Continue, and the result card.             |

The person's game runs in the view at one tick per 150 ms, with the same pure rules the backend has.
The view saves the headings it played about every two seconds and when the game ends. The backend
replays them from the stored board; food comes from a seeded generator kept in the game, so the
saved board is the one on screen. Which ticks are due is derived from the time of the last one.

The decision model's game runs in the backend. Each move asks one `choice` question over the
headings the snake may take, with code-computed facts for each: whether it dies, whether it eats,
the distance to the food after it, and the free cells the head can still reach. The run writes every
move, so the open board follows it through the store feed. It stops on a crash, **Stop**, switching
to **I play**, or a decision without a move (whose reason the board shows, with **Continue**).

## Source of truth

- [Mini app manifest](mini-app.json) and [agent guide](guide.md)
- [Rules](shared/game.ts)
- [The decision question](backend/ask-decision.ts)
- [The person's run](ui/game/useHumanRun.ts)
