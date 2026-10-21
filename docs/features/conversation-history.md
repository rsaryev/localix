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

Within explicitly linked assistant continuation segments by the same author, a repeated item ID
belongs to the segment that first recorded it. The history uses its latest outcome once, keeping the
new segment's new work in order. Independent messages, different authors, and calls with the same
wording remain separate.

## Find and recover earlier messages

Sidebar search filters titles immediately and searches stored message text after you enter at least
two characters. It applies to the open history tab; the **External** tab filters
[native CLI sessions](external-agents.md#sessions-and-projects) by title only. **Found in messages**
shows one row per conversation from up to 30 ranked message hits; many matches in one conversation
can leave fewer result rows. Selecting a row opens the conversation, not the exact matching message.
Rows whose sessions are absent from the loaded sidebar list are omitted. Search uses quoted
full-text terms together, not a substring, regular expression, or semantic similarity search.
Punctuation-only input has no searchable terms. An unavailable index or a search failure can appear
as no results.

An agent with `global_search` can recover earlier text when you refer to past work, follow a
checkpoint pointer, or inspect another session in your workspace:

| Request             | Result                                           | Boundary                                                |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| `query`             | Ranked sessions, short snippets, and nearby text | Defaults to five sessions; discovery is capped at ten   |
| `around_message_id` | Messages before and after that message           | The session is inferred; an explicit session must match |
| `session_id` alone  | A window ending at that session's latest message | Defaults to five messages on each side; maximum fifteen |
| No arguments        | Recent sessions with previews                    | Defaults to ten; maximum twenty                         |

These reads are scoped to the Localix user. They query stored history independently of the current
model view: a checkpoint or topic change does not erase the older rows. Archived sessions and
inactive message branches can still contribute results. A window follows stored message sequence, so
it can cross branches or topic boundaries rather than reconstructing one active path. Discovery
examines a bounded set of ranked hits; it is not an exhaustive inventory.

The search index covers message text, not tool inputs/results or attachment and context-binding
bodies. Agent previews are clipped to 200 characters in discovery and 500 in scroll mode, with an
8,192-character total JSON budget. Large discovery replies drop bookends, then nearby messages, then
trailing sessions with an omission notice. An oversized single result returns a truncation notice.
Use narrower queries or `tool_output` for an original tool artifact; these previews are not an exact
replay of a complete turn.

## Model context

Client-only terminal lifecycle notices are presentation metadata and are not sent to the model. Tool
calls and their results still reach the agent's history. Repairing a repeated continuation prefix
prevents those same calls and results from appearing twice in the model context as well. Independent
terminal observations keep their normal checkpoint and output-size policies.

See [Context checkpoints](context-checkpoints.md),
[Sessions and projects](sessions-and-projects.md), [Conversations](conversations.md),
[Background work](background-work.md) and [Interactive terminals](interactive-terminals.md).

## Source of truth

- [Sidebar message search](https://github.com/rsaryev/localix/blob/main/apps/ui/src/entities/chat/model/useHistorySearch.ts)
- [History tool modes](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/history/history-search.ts)
- [History query scope](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/repository-history.ts)
- [Preview and output limits](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/history/history-search-format.ts)
- [Transcript projection](https://github.com/rsaryev/localix/blob/main/apps/ui/src/entities/chat/ui/transcriptProjection.ts)
- [Adjacent notice equality](https://github.com/rsaryev/localix/blob/main/apps/ui/src/entities/chat/ui/coalesceSystemMessages.ts)
- [Model wire-history projection](https://github.com/rsaryev/localix/blob/main/packages/agent/src/agents/chat.ts)
- [Action blocks](https://github.com/rsaryev/localix/blob/main/apps/ui/src/entities/chat/ui/tool-parts/ToolChain.tsx)
- [Continuation item ownership](https://github.com/rsaryev/localix/blob/main/packages/agent/src/agents/continuation-items.ts)
