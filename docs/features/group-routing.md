# Group routing

In a group conversation, `@handle` decides exactly who answers. It cannot see a message that plainly
belongs to one participant without naming them, an agent that hands work on by name ("Lawyer, check
the wording"), or an `@handle` that only credits a colleague. Group routing asks a decision model
who should speak next in those cases, and follows it only when the model is sure.

**Availability:** On by default. It runs `~typesafe/jev-latest` through OpenRouter, so it starts
working once OpenRouter is connected and does nothing without a connection that serves its model.

## What you can do

| Capability                   | Mechanism                                                           | Boundary                                                          |
| ---------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Turn it on                   | Connect OpenRouter; the workload is already on                      | Group conversations only; a solo conversation has nobody to route |
| Turn it off                  | The **Group routing** switch in the model browser's workload column | Routing then follows `@handle` alone, as before                   |
| Choose the model             | The workload's model list, which shows decision models only         | Any connected provider's decision model                           |
| Go back to the default model | The list's reset row                                                | The default is `~typesafe/jev-latest`                             |
| See what it costs            | **Group routing** in the cost workbench's kind breakdown            | About $0.00004 per decision with the default model                |

## How it works

A decision model writes no text. It reads structured state and answers a typed question with a
probability for each option. Localix asks one question per event: who should take the floor next.

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

## Configuration

The workload is stored like every other one, in `agentSettings.modelRouting.groupRouting`: `enabled`
(absent means on) and an optional `providerConnectionId` with `modelId`. With no model picked, any
live connection of OpenRouter serves the default. Decision models come from the same provider
catalogs as chat models; see [Providers](providers.md#how-the-model-list-stays-current).

## Limits

- Each decision adds about 0.3 s before the next turn starts, and at most three seconds.
- A decision cut off at three seconds may still be billed by the provider, but its cost is not
  recorded, because no usage came back.
- Only decision models served by a connected provider are offered; none run on this computer yet.
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
- [The workload's settings and call](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/floor-advisor.ts)
- [Unaddressed messages](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/conversation-strategy.ts)
- [Reply handoffs](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/conversation-routing.ts)
- [Decision models in the catalog](https://github.com/rsaryev/localix/blob/main/packages/agent-runtime-pi/src/catalog.ts)
