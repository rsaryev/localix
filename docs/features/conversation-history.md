# Read conversation activity

The conversation keeps the agent's explanations and results in the main timeline. Routine terminal
input, waits and completion events live inside the existing action blocks. Expand a block to inspect
its calls and lifecycle details in order.

## Follow live work

The latest action block follows work while the response is running. A finished block folds into its
summary. You can expand or collapse it yourself; your choice takes precedence over automatic
folding. Terminal waits still update the response's live status. A completed wait becomes a detail
inside the action block rather than another standalone line in the conversation.

Failures, warnings and notices offering a recovery action remain visible in the main timeline.
Closing a terminal through its controls records a stopped outcome instead of a process failure.

## Inspect the sequence

Adjacent equal system messages share a count. Their timestamps do not determine equality, and a
different message interrupts the sequence: `A → A → B → A` becomes `A ×2 → B → A`. Different
statuses and recovery actions remain distinct. Unique secondary details are retained in the notice
tooltip.

When an assistant response continues in another segment, a repeated item ID belongs to the segment
that first recorded it. The history uses its latest outcome once, keeping the new segment's new work
in order. Independent calls with the same wording remain separate.

## Model context

Client-only terminal lifecycle notices are presentation metadata and are not sent to the model. Tool
calls and their results still reach the agent's history. Repairing a repeated continuation prefix
prevents those same calls and results from appearing twice in the model context as well. Independent
terminal observations keep their normal checkpoint and output-size policies.

See [Conversations](conversations.md), [Background work](background-work.md) and
[Interactive terminals](interactive-terminals.md).

## Source of truth

- [Transcript projection](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/chat/ui/transcriptProjection.ts)
- [Action blocks](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/chat/ui/tool-parts/ToolChain.tsx)
- [Continuation item ownership](https://github.com/rsaryev/localix/blob/main/packages/agent/src/agents/continuation-items.ts)
