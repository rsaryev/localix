# Group routing

In a group conversation, `@handle` decides exactly who answers. It cannot see a message that plainly
belongs to one participant without naming them, an agent that hands work on by name ("Lawyer, check
the wording"), or an `@handle` that only credits a colleague. Group routing asks a model who should
speak next in those cases, and follows it only when the model is sure.

**Availability:** Always on, with nothing to set. What answers depends on what is available:

| What is available                           | Who decides                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| An OpenRouter connection                    | The decision model `~typesafe/jev-latest` (Jev)                                               |
| No OpenRouter, the embedding model ready    | EmbeddingGemma 2 by similarity, for your untagged messages only; replies by the address rules |
| Neither, or the one chosen fails or is late | The address rules (`@handle`), as before                                                      |

Every miss is silent: the conversation goes on by the address rules, and nothing is shown.

## What you can do

| Capability          | Mechanism                                                                              | Boundary                                                          |
| ------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Use Jev             | Connect OpenRouter                                                                     | Group conversations only; a solo conversation has nobody to route |
| Stop sending to Jev | Disconnect OpenRouter; routing falls back to the embedding model and the address rules | There is no separate switch                                       |
| See what it costs   | **Group routing** in the cost workbench's kind breakdown                               | About $0.00004 per decision with Jev; the embedding model is free |

## How it works

The strategies form a chain: each says whether it can answer right now, and the first that can
decides. A decision model writes no text. It reads structured state and answers typed questions with
a probability for each option. Localix asks who should take the floor next; for a message of yours
that names nobody, it asks two more questions in the same request (see
[Your untagged messages](#your-untagged-messages)).

1. **The window.** The last eight visible messages, the event's own included. Each message keeps its
   first and last 250 characters, because a reply states its result first and hands the floor on at
   its end. Hidden prompts and interface notes are left out.
2. **The options.** After your message: every participant, each described the way the agent
   directory describes it. After an agent's reply: every colleague except the author, and you.
3. **The threshold.** The model's pick counts only when its probability is at least 0.8. Below that,
   after a failed call, or when the whole decision takes longer than three seconds, the address
   rules decide.

Only words you typed are put to the model: hidden prompts, webhook and wake texts route by the
address rules alone. After a reply, the transcript is read as it stands when the reply settles, so
messages that arrived during the run count. A chain that has reached the handoff limit is not asked.

What the pick changes:

| Event                                  | Address rules alone                   | With a confident pick                                                            |
| -------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| Your message names someone, or `@all`  | Those participants                    | Unchanged: the model is not asked                                                |
| Your message names nobody              | The leader                            | The participant the model names                                                  |
| A reply addresses a colleague          | That colleague                        | Kept when the model agrees; you, when the `@` only credited them                 |
| A reply hands on by name, without `@`  | You, or the colleague who assigned it | The colleague the model names, unless the reply reports to whoever assigned it   |
| A reply reports to whoever assigned it | That colleague                        | Unchanged, and the model is not asked: finished work reaches the one who gave it |

On 1,814 labelled turns from synthetic group conversations in Russian and English, the address rules
alone chose the right speaker 74% of the time, the model alone 80%, and the model above the 0.8 bar
with the address rules below it 86%.

### Your untagged messages

The leader exists to coordinate: to split work that needs several participants, record what depends
on what, and check the result. "Who of all of them" hides that judgment, and two participants with
close fields can split the one answer below the bar even when the leader is plainly not the one. So
the request adds:

- **One participant alone?** Can one participant act on the message alone, without the leader
  coordinating several of them? A whole feature, a question of who does what, small talk and general
  questions count as "no".
- **Which one?** The participant who can, chosen among everyone, the leader included.

| Answer                                                                                 | Who answers               |
| -------------------------------------------------------------------------------------- | ------------------------- |
| "One participant alone?" below 0.4                                                     | The leader, to coordinate |
| Otherwise, the main pick at 0.8 or more                                                | That participant          |
| Otherwise, "one participant alone?" at 0.6 or more and a pick leading with 0.5 or more | The picked participant    |
| Otherwise                                                                              | The leader                |

The leader is whoever the conversation elects by leadership priority, so it may be a specialist: the
questions name coordination, not a general assistant, and the leader can be the one picked for work
in its own field. On the 445 untagged messages of the set, this took the share routed right from 73%
to 81%: 76% of the messages meant for a specialist reached one, and 85% of those meant for the
leader stayed with it (79% and 68% with the single question).

### Without OpenRouter

EmbeddingGemma 2, the model Localix keeps for search, compares the last three messages with each
participant's description. The nearest one takes your untagged message when it leads the next by a
clear margin; otherwise the leader does. Replies stay with the address rules: similarity sees what a
reply is about, not whether it reports or hands work on. Nothing leaves this computer. It is a
modest gain — measured, it routes an untagged message right a few points more often than the address
rules alone, against about twenty for Jev.

## Decision log

Every decision writes one `conversation.floor_advice` record to the API log, read with
`bun run logs --source api`: the session, whether it followed your message or a reply, the strategy
and model, the time taken, the scores or probabilities, the participant followed (or none) and why —
`confident`, `alone`, `coordinate`, `similar`, `unsure`, or `none`, `deadline`, `error`. It holds no
message text.

## Limits

- Each decision adds about 0.3 s before the next turn starts, and at most three seconds.
- A decision cut off at three seconds may still be billed by the provider, but its cost is not
  recorded, because no usage came back.
- Jev is the only decision model used; it runs through OpenRouter, not on this computer.
- The model sees eight messages, so a handoff that depends on older context goes by the address
  rules.
- Every hop still counts toward the handoff limit described in
  [Conversations](conversations.md#passing-work-between-agents).

## Related guides

- [Conversations](conversations.md)
- [Providers](providers.md)
- [Cost tracking](cost-tracking.md)

## Source of truth

- [Advice: window, request, threshold](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/floor-advice.ts)
- [The chain of strategies](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/floor-advisor.ts)
- [Jev through OpenRouter](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/floor-decision.ts)
- [The embedding model by similarity](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/floor-similarity.ts)
- [Unaddressed messages](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/conversation-strategy.ts)
- [Reply handoffs](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/conversation-routing.ts)
- [Decision models in the catalog](https://github.com/rsaryev/localix/blob/main/packages/engine-models/src/catalog/normalize.ts)
