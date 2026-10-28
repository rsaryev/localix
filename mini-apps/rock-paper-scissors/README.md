# Rock Paper Scissors

Rock paper scissors in the workbench, one table per chat, played against the agent in that chat.
Each round is two **sealed** moves: whoever opens commits first, and the other side sees only a
digest of that move until it has chosen too. The round then reveals both moves, scores them, and the
view checks the revealed move against the digest it showed before.

It is the reference mini app for [sealed moves](../../docs/extending/sealed-moves.md): a secret the
agent commits to that the user may not read until the mini app reveals it.

## How a round goes

Openers alternate from round to round; the agent's `next_round` may name one.

- **You open.** Your move is sealed on arrival. The table wakes the chat with the round as the agent
  may see it — your move as a digest only. The agent answers with `rock_paper_scissors` action
  `play`, and the round is revealed.
- **The agent opens.** The next round wakes the chat. The agent seals its move with `play`; the chat
  shows the call with `move: [sealed]`, and the table shows a face-down card with its digest. Your
  choice reveals the round. The view recomputes the digest in the browser and shows **Digest
  checked**.

## What keeps a move secret

| Who must not see it | What hides it                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The user            | The tool declares `presentation: { sealed: { input: ['move'] } }`, so the host never stores or streams the argument. Routes answer `viewFor(game, 'you')`. |
| The agent           | The wake, every tool result and the chat context are built from `viewFor(game, 'agent')` or `describeForChat`, which never name an unrevealed move.        |
| Either, afterwards  | The digest (`sha256(salt:move)`) is shown before the reveal, so a swapped move fails the check.                                                            |

No result ever names the agent's own unrevealed move: results are shown to the user too. The guide
tells the agent not to deliberate in writing, because its reasoning and replies are visible. The
table file in the chat's session storage holds both moves in the clear, like every bundled game's
state; the mini app does not defend against reading it from disk.

## The agent's tool

| `action`     | Does                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| `play`       | Seals the agent's `move` (`rock`, `paper`, `scissors`), only on its turn.   |
| `state`      | Reads the round, the score and the last result, as the agent may see them.  |
| `next_round` | Starts the next round, opened by `first` (default the user), and offers it. |

A sealed move that answers a wake ends the turn (`terminate`). The move that reveals a round asks
for one short line. `state` is classified `read`; the other actions are `session`.

## Layout

| Location                  | Responsibility                                                    |
| ------------------------- | ----------------------------------------------------------------- |
| `shared/game.ts`          | Rounds, sealed moves, the rules and `viewFor`, the per-side view. |
| `shared/describe.ts`      | The table as text for the agent, built from a view only.          |
| `backend/game-service.ts` | Every change to a chat's table; seals each move as it arrives.    |
| `backend/ask-agent.ts`    | The wake request: the agent's view, the answering tool, the key.  |
| `backend/routes.ts`       | The table's routes; each answers with the person's view.          |
| `backend/tools.ts`        | The agent's tool and its sealed `move`.                           |
| `ui/`                     | The two hands, the move picker, the digest check.                 |
| `guide.md`                | How the agent plays without giving its move away.                 |

See [Wake a session from a mini app](../../docs/extending/mini-app-wakes.md) for the wake contract.
