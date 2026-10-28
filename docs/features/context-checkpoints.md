# Keep a long session inside the request budget

Localix shows the model a bounded view of a session while the stored transcript stays whole. Use
this page to understand what the agent still sees after a long conversation, and how to keep a
message in its view.

## Terminology

| Term            | Meaning                                                                                         | Boundary                                                           |
| --------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Request ceiling | The context limit, or the window minus the response reserve; every request must fit it.         | Per model from the catalog window, capped by delegation depth.     |
| View            | The model-facing copy of the conversation one agent reads on a turn.                            | Stored messages are never rewritten to build it.                   |
| Checkpoint      | A one-time, model-free re-plan of the view when it reaches the high-water mark.                 | Between checkpoints the view is only appended to.                  |
| Epoch card      | A short deterministic summary of evicted turns: files, commands, errors, requests, last answer. | Lists facts; it does not carry the reasons behind decisions.       |
| Pin             | A person's mark that keeps one message whole in the agent's view.                               | Set from the message context menu; stays within the current topic. |

## What you can do

| Action                    | Result                                                                                  | Boundary                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Set the context limit     | Model details → **Context limit**: **Auto**, a token step the model holds, or **Full**. | Shown only for a model whose window exceeds 272k plus its reserve.           |
| Watch the usage ring      | See request size against the ceiling and the **Next checkpoint at** figure.             | Limits arrive with a run's first snapshot, at the session's depth.           |
| See where the view begins | An **Earlier turns checkpointed** divider marks the last evicted message.               | Only the newest checkpoint is drawn; an old topic boundary removes the line. |
| Keep a message whole      | Right-click a message → **Pin to agent context**; a pinned mark appears under it.       | The next checkpoint preserves it; a late pin uses a bounded context insert.  |
| Start a clean context     | Open a new chat.                                                                        | Earlier messages stay visible in the stored transcript.                      |
| Recover older output      | The agent follows `ToolOutput` handles or `GlobalSearch` pointers.                      | The tool must be in the agent's roster for its pointer to appear.            |
| Replay a stored session   | Run `replay-context-policy <sessionId>` against `localix.db`.                           | Read-only; prints every number a checkpoint decision turned on.              |

### Context limit

The context limit is how many tokens a request may hold before a checkpoint reshapes the view. It is
set per agent and model, like a reasoning level, and offered from the model's own window:

| Choice | Request ceiling                                               |
| ------ | ------------------------------------------------------------- |
| Auto   | `min(272,000, window − reserve)`; the default.                |
| Steps  | 128k, 200k, 400k, 600k, 1M, 2M, 5M or 10M — those below Full. |
| Full   | The whole window minus the response reserve.                  |

A model whose Auto already is its whole window (up to about 302k) shows no setting. Long contexts
cost more on every request and recall worse, so Auto stops at 272k even on a 1M window; choose a
larger step when a task needs it, or a smaller one to save cost. A step remembered from a larger
model reads as this model's Full.

No command summarizes the conversation with a model. The runtime checkpoints on its own, and
`/compact` asks for one by hand: every agent of the chat takes a checkpoint on its next turn,
whatever was measured, and a conversation already below the target is left whole. Text after the
command, as in `/compact keep the plan`, goes to Claude Code's `PreCompact` hooks as
`custom_instructions`; the cards are written without a model, so it does not steer them.

When a card's request list must shrink, it retains the newest requests. Trusted amendments from a
delegator remain labeled **assignment update**; ordinary runtime wakes are not quoted as requests.
These are bounded records, not a complete copy of every instruction: recover the original message
when a clipped detail matters.

## How it works

### One history strategy, two moments

Every run — the interactive chat, a delegated task run, a delegated sub-agent, a loop round, a hook
verifier — turns its stored transcript into a model request through the one `chat-hybrid` **history
strategy**. A sub-session is an ordinary session with a narrower tool surface, not a different
runtime.

| Moment      | When                                      | What it does                                                            |
| ----------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| Materialize | Once per turn, before the first request   | Runs the stages below over the stored rows and the frozen view.         |
| Request     | Before every provider request in the turn | Prunes only near the ceiling; a prune asks the next turn to checkpoint. |

Side effects (mini app prompt rewrites, Claude Code prompt hooks, job and diagnostics snapshots)
happen once, in the **intake** step. Everything after intake is pure, so a retry re-derives the same
wire from the same frame without re-firing a hook.

Materialize runs these stages in order. The list is pinned by a repository test against the stage
sources, so a stage cannot be added or renamed without this page changing:

| Stage           | Kind         | Effect                                                                                                                                                             |
| --------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clear-cut`     | Load-bearing | Drops the latest stored `/clear` or topic boundary and everything before it.                                                                                       |
| `agent-history` | Load-bearing | Keeps the agent's own rows with their structured work, drops empty silent rows, and passes every other row through.                                                |
| `turn-context`  | Load-bearing | Puts every past turn's stored runtime context back before the reply it preceded, and appends this turn's — only the sections that changed — last.                  |
| `media`         | Seam         | Rows become model payloads: steer notes, invocation text, media rehydration, spill, image downscale.                                                               |
| `checkpoint`    | Load-bearing | Applies the frozen checkpoint in force; when one is due, plans a new one without a model call (mask and fold first, then evict the oldest turns into epoch cards). |
| `preflight`     | Load-bearing | Refuses an active turn, or first task + active turn, that no checkpoint could fit.                                                                                 |
| `admission`     | Load-bearing | Final measured-or-estimated size against the ceiling; a view that does not fit and took no checkpoint takes one.                                                   |

A load-bearing stage that fails ends the run with a typed local budget error. No stage rewrites a
stored message.

### Topic boundaries and late pins

No agent tool places a topic boundary. A session that already holds one keeps it. Everything before
the boundary stays in the stored transcript but leaves subsequent requests, and the saved summary
carries forward what still matters.

A message pinned after a checkpoint may already be folded or evicted. Until the next checkpoint
preserves it in the view, the runtime inserts its text into a `# Pinned messages` section, capped at
4,000 characters per message with middle truncation. That temporary text is not an exact replay of
attachments or tool results. Pins can increase context pressure; they do not create extra request
capacity.

### Append-only between checkpoints

The same stored rows produce the same request bytes on every turn until the next checkpoint. That
keeps the provider's prefix cache warm and keeps preserved thinking valid, since a model's signed
reasoning is bound to the exact prefix before it.

| Kept stable                  | How                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Runtime context              | Keyed sections; a turn stores and sends only what changed, as a `<runtime-context update>`. |
| Mid-run facts                | A job finishing mid-turn rides the tool result it arrived with, not a separate message.     |
| Invocation text and images   | Attached on every turn, not only on the newest one.                                         |
| Superseded live-state output | Collapsed only at a checkpoint, never between.                                              |

The runtime context and each checkpoint are stored per assistant turn in the
`agent_message_model_context` table, written before the request is sent. A crash mid-run therefore
never leaves a sent request the log cannot rebuild.

### When a checkpoint is taken

| Signal                                          | Result                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| Last provider-measured request ≥ 85% of ceiling | The next turn takes a checkpoint.                                           |
| Last measured request ≥ 72% of ceiling          | The agent is told once that a checkpoint is near, so it can save to memory. |
| The in-run safety net had to prune              | The next turn takes a checkpoint.                                           |
| The built view does not fit the ceiling         | This turn takes a checkpoint and rebuilds.                                  |
| Provider overflow or a silently empty response  | A checkpoint is taken and the turn reruns once.                             |

A checkpoint cuts the view to about 30% of the ceiling, or a quarter of the history budget on a
small window. It first masks old tool observations and folds long assistant answers to their head
and tail. Only if that is not enough does it evict the oldest whole turns, always cutting before a
user turn. Eviction never undoes an earlier eviction.

Evicted turns become epoch cards. Cards degrade from the oldest first when they exceed 12% of the
target. Pinned messages that fall inside an evicted range stay verbatim after the cards. Kept rows
lose their stored reasoning, which a rewritten prefix would invalidate anyway.

### What the agent is told

| Section                      | When it appears                                                  |
| ---------------------------- | ---------------------------------------------------------------- |
| `# Context checkpoint ahead` | Once, past the 72% mark: what a checkpoint keeps of older turns. |
| `# Pinned messages`          | A pin the checkpoint in force shows only in part or not at all.  |

Cards and folded answers point at `GlobalSearch(around_message_id="…")`, which scrolls around a
message without needing its session id. The pointers appear only when `GlobalSearch` is in the
agent's roster.

### Hooks

A checkpoint is this runtime's compaction for Claude Code hooks. `PreCompact` fires before the
checkpoint is committed, with trigger `auto`, or `manual` and the typed text as
`custom_instructions` after `/compact`; `PostCompact` follows with the same trigger. A block skips
the checkpoint, as [Hooks and commands](hooks-and-commands.md#declarative-hooks) describes. The next
run fires `SessionStart` with source `compact`, so a hook can re-inject context the new view no
longer carries.

### Request budget

| Control           | Current rule                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Policy window     | The smallest window whose ceiling is the context limit, at most the catalog window (`128,000` when unknown); capped by depth. |
| Cap by depth      | None for a conversation, `128,000` for its child, `64,000` below                                                              |
| Response reserve  | `max(min(16,384, 20% of window), 10% of window)`                                                                              |
| Request ceiling   | Policy window minus response reserve: the context limit, or less where the window or depth cap is smaller.                    |
| Checkpoint mark   | 85% of the ceiling                                                                                                            |
| Checkpoint target | 30% of the ceiling minus fixed overhead, at least 25% of history budget                                                       |
| Protected tail    | Up to 8 recent messages within `clamp(15%, 16,384, 65,536)` tokens                                                            |

### How a request is sized

| Source               | Rule                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Provider measurement | The newest assistant turn's `contextTokens`, valid within the same view epoch, prompt, tools and model. |
| Trailing estimate    | Messages after that measurement are estimated at ~4 UTF-8 bytes per token of their wire JSON.           |
| Images and media     | A flat `1,600`-token allowance per part until the model has taught its real cost.                       |
| Learned calibration  | Measured requests teach a per-model text scale and per-image cost by moving average; process-lived.     |

A checkpoint is scheduled only from a provider measurement. A heuristic figure near the mark waits
for the next measured request; only a view that exceeds the ceiling checkpoints on an estimate.

### Recovery handles

Completed tool calls cross a durable artifact barrier before the next model request, so masking can
cite the original `tool_call_id`. Run preparation requires `ToolOutput` with its `get` operation.

| Recovery path  | What it restores                              | Boundary                                                         |
| -------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| `ToolOutput`   | Stored text or successful mutation input.     | Active branch only; one replay is clipped at 100,000 characters. |
| `GlobalSearch` | Messages around an evicted or folded message. | This user's history only.                                        |
| Read or rerun  | Current files or reproducible command output. | Required for stale reads or unstored detail.                     |

## Configuration

| Control                                                                     | Effect                                                             | Boundary                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------- |
| **Pin to agent context** / **Unpin from agent context**                     | Keep a message whole in the agent's view.                          | Not offered for hidden internal messages. |
| `bun apps/api/scripts/replay-context-policy.ts <sessionId>`                 | Print measured sizes, pressure bands and a checkpoint planned now. | Read-only against the database.           |
| `bun apps/api/scripts/check-compression.ts <raw.json> [--context-window N]` | Report token sources and how far masking and folding get alone.    | Does not plan the eviction.               |

## Limits

- Epoch cards list facts, not reasoning. What must survive with its reasons belongs in memory or a
  pin.
- Masking cannot restore bytes a tool removed earlier by paging, truncation or an output cap.
- `ToolOutput` restores text, not image-only media.
- A checkpoint cannot shrink an oversized active user turn or reclaim the system prompt and tool
  roster. Large pins can also prevent sufficient history reduction. Localix reports those as
  separate local budget failures.

## Related guides

- [Cost tracking](cost-tracking.md)
- [Sessions and projects](sessions-and-projects.md)
- [Conversation topics](sessions-and-projects.md#session-objective-and-previous-topic-summary)
- [Hooks and commands](hooks-and-commands.md)

## Source of truth

- [Checkpoint marks and target](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/model-view/checkpoint-policy.ts)
- [Model view loader](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/model-view/view.ts)
- [Runtime-context deltas](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/model-view/turn-context.ts)
- [Late-pin insertion](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/model-view/pins.ts)
- [Pins, hints and the checkpoint warning](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/model-view/sections.ts)
- [Checkpoint planner, cards and projection](https://github.com/rsaryev/localix/blob/main/packages/agent/src/context/checkpoint/)
- [Chat history strategy and stage list](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/history/chat-strategy.ts)
- [Materialize stages](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/history/stages/)
- [Per-request safety net](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/history/request-transform.ts)
- [Overflow and empty-run recovery](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/recovery.ts)
- [Request budget](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/context-budget.ts)
- [Transcript divider](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/api/modelViewDivider.ts)
- [Replay a stored session](https://github.com/rsaryev/localix/blob/main/apps/api/scripts/replay-context-policy.ts)
