/**
 * THE AGENT'S OWN ROWS, AS ITS MODEL READS THEM.
 *
 * A conversation has one agent, so the projection is small: the agent's rows keep their
 * structured work (a tool the run is not holding becomes a historical observation), empty silent
 * rows are dropped so the provider never receives an empty assistant turn, and every other row —
 * the person's messages, routed data — passes through as it stands. A failed turn of the agent
 * stays in its history.
 *
 * PURE and TOTAL: the same transcript and tools always yield the same bytes. The prompt cache
 * depends on it, so nothing here may consult a clock, a registry, or anything outside its
 * arguments.
 */
import type { HistoryStage } from '@localixai/agent/history'
import { isToolBackedItem } from '@localixai/agent/agents'

import type { StoredMessagePayload } from '../../../../../db/payload'
import { isAgentAuthor } from '../../../../../db/author'
import type { PersistedMessage } from '../../../contracts'

/** Is this row something the agent SAID, rather than something the system routed in? */
function isSpokenRow(payload: StoredMessagePayload): boolean {
  return typeof payload.from === 'string' && isAgentAuthor(payload.from)
}

/**
 * An empty usage-only row of the agent's own: a silent turn with no structured work. Silence
 * hides the public reply, not the useful tool history, but the provider must never receive an
 * empty assistant turn.
 */
function isUnreadableRow(payload: StoredMessagePayload): boolean {
  return isSpokenRow(payload) && payload.isInternal === true && payload.role === 'assistant'
    ? !payload.items?.length
    : false
}

/**
 * Replay available tools structurally; retain other results as historical observations.
 *
 * A model reads its own history as proof of what it can do, so a call to a tool the run is not
 * holding is an invitation to hallucinate that tool back into existence. This applies to every
 * tool-backed item, including shell commands and MCP calls. Turning an unavailable call into
 * text preserves the work without advertising an executable capability.
 */
function gateToolItems(
  items: StoredMessagePayload['items'],
  tools: ReadonlySet<string> | undefined,
): StoredMessagePayload['items'] {
  if (!tools || !Array.isArray(items)) return items
  let changed = false
  const kept = items.flatMap((item) => {
    if (!isToolBackedItem(item) || tools.has(item.name)) return [item]
    changed = true
    const result = item.error?.userMessage ?? item.resultText ?? item.errorText
    if (!result) return []
    return [
      {
        id: item.id,
        type: 'text' as const,
        status: 'completed' as const,
        turnIndex: item.turnIndex,
        text: `Historical observation from unavailable tool ${JSON.stringify(item.name)}:\n${result}`,
      },
    ]
  })
  return changed ? kept : items
}

/**
 * The projection. `tools` are the tool names the run is actually holding (post-profile,
 * post-capability, post-plugin); absent means "do not gate", which is what every caller outside a
 * run wants.
 */
export function projectAgentHistory(
  messages: readonly PersistedMessage[],
  tools?: ReadonlySet<string>,
): PersistedMessage[] {
  const out: PersistedMessage[] = []
  for (const message of messages) {
    const payload = message.payload
    if (isUnreadableRow(payload)) continue
    if (!isSpokenRow(payload)) {
      out.push(message)
      continue
    }
    const items = gateToolItems(payload.items, tools)
    if (payload.isInternal && !payload.content?.trim() && !items?.length) continue
    out.push(items === payload.items ? message : { ...message, payload: { ...payload, items } })
  }
  return out
}

/** The stage. */
export function agentHistoryStage(tools?: ReadonlySet<string>): HistoryStage<PersistedMessage> {
  return {
    name: 'agent-history',
    run: (messages) => ({ messages: projectAgentHistory(messages as PersistedMessage[], tools) }),
  }
}
