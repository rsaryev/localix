# Sealed moves

A sealed move is a value one player commits to (a move, a word, a number) that the other players may
not read until the mini app reveals it, and that its owner cannot change after committing. The Rock
Paper Scissors mini app of the [Localix marketplace](https://github.com/rsaryev/localix-marketplace)
is the reference. A word-guessing game, where one agent picks the word and the user or other agents
guess, uses the same three parts.

## Terminology

| Term       | Meaning                                                                         | Boundary                                                          |
| ---------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Sealed     | A committed value with its salt and digest, kept whole by the mini app backend. | Never sent to anyone but its owner before the reveal.             |
| Digest     | Hex SHA-256 of `salt:value`.                                                    | Shown before the reveal; proves nothing was swapped.              |
| View       | What one audience may see of a commitment: the digest, or everything.           | Built per audience by the mini app, e.g. `viewFor(game, viewer)`. |
| Sealed key | A tool input field the host withholds from storage and from clients.            | The calling model keeps the real value for the rest of its run.   |

## What you can do

| Task                                         | Mechanism                                                       | Boundary                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Let the agent commit without the user seeing | `presentation: { sealed: { input: ['move'] } }` on the tool     | Top-level input keys only. The chat shows `[sealed]` in their place.                        |
| Withhold a tool's whole result               | `presentation: { sealed: { result: true } }`                    | Also withholds details, so an offered view link is lost. Prefer results that never name it. |
| Commit to a value                            | `seal(value, owner, at)` from `@localixai/mini-app-sdk/backend` | Values are strings. A fresh 16-byte salt each time.                                         |
| Show another audience the commitment         | `sealedView(sealed)` from `@localixai/mini-app-sdk/sealed`      | The digest only, until `revealSealed(sealed, at)`.                                          |
| Let the user check the reveal                | `verifySealed(view)` in the browser                             | WebCrypto; false for an unrevealed or tampered view.                                        |

## How it works

1. The agent calls the mini app's tool with the secret in a sealed key. The host replaces the key
   with `[sealed]` in the tool item before the first copy is persisted or streamed. That is the
   accumulator funnel that already shields credentials, so every copy is covered: streamed
   arguments, progress, the result and a failed call's error.
2. The tool seals the value (`seal`) and keeps the whole record in its own storage. The tool result
   must not name the value: results are shown to the user.
3. Every route answer, wake message and published chat context is built from a per-audience view
   that carries `sealedView(...)` for anything the audience may not read.
4. When the game's rule says so, the mini app calls `revealSealed`. From then on the view carries
   the value and salt, and `verifySealed` lets the user's own browser confirm the digest.

### Subagents

A subagent's tool calls and results stay in its own session: its parent reads only its final report.
A secret in a sealed key therefore reaches neither the user nor the parent through the subagent's
history. The mini app can tell agents apart through the tool context's `session.agent.agentId` and
pass it to `seal` as the owner.

### What it does not hide

- The model's own text and reasoning stream to the user. The mini app's guide must tell the agent
  not to deliberate or hint in writing, and a sealed move that answers a wake should end the turn.
- After the run, the author's own history holds `[sealed]` too. A game that needs the secret on a
  later turn returns it through a tool whose result is sealed (`result: true`) or keeps the agent
  from needing it.
- Mini app storage is ordinary files in the chat's session folder on the user's machine.

## Source of truth

- [Sealing in the item funnel](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/sealed-items.ts)
- [Tool presentation contract](https://github.com/rsaryev/localix/blob/main/packages/agent/src/agents/tool-definition.ts)
- [Commitments and views](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/sealed.ts)
- [A sealed-move game's rules and per-side view](https://github.com/rsaryev/localix-marketplace/tree/main/mini-apps),
  in the marketplace
