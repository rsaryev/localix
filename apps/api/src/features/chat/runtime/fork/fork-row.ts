import { isToolBackedItem, type AgentItem } from '@localixai/agent/agents'

import type { StoredMessagePayload } from '../../../../db'
import { FORK_CALL_RESULT } from '../../../agent-core/tools/agent/agent-fork'

const FINISHED = new Set(['completed', 'failed', 'aborted'])

/**
 * The fork's copy of the parent's assistant row at the moment of the call.
 *
 * The parent is still writing that row, so the fork takes a frozen copy as its own first row. What
 * the model reads of it is what the parent's own next request would read, with one difference: the
 * calls of the step that made the call, which had not finished, are answered (`FORK_CALL_RESULT`),
 * so every call has its result, as a request needs. Calls of earlier steps keep what they have: an
 * async one that is still running reads as running, as it does in the parent's own history.
 *
 * Only what the model reads is copied: no usage, timing or diagnostics of a run that is not the
 * fork's. The parent's payload is not changed.
 */
export function forkSnapshotPayload(
  payload: StoredMessagePayload,
  toolCallId: string,
  id: string,
): StoredMessagePayload {
  const items = (payload.items ?? []) as AgentItem[]
  const call = items.find((item) => isToolBackedItem(item) && item.toolCallId === toolCallId)
  if (!call) throw new Error(`The call ${toolCallId} is not in the row it was made from`)
  const frozen = items.map((item): AgentItem => {
    if (!isToolBackedItem(item) || item.turnIndex !== call.turnIndex) return { ...item }
    if (FINISHED.has(item.status)) return { ...item }
    const { error: _error, errorText: _errorText, ...kept } = item
    return { ...kept, status: 'completed', resultText: FORK_CALL_RESULT } as AgentItem
  })
  return {
    id,
    role: 'assistant',
    from: payload.from,
    // The words are in the text items. Left in `content` they would be the last thing the fork
    // "said" when it has said nothing yet, and a report is the last thing a child said.
    content: '',
    // Read by the model as its own line, but not a message of the fork's chat: the person who
    // opens the fork sees the directive and what the fork does, not the parent's row.
    isInternal: true,
    items: frozen,
  } as StoredMessagePayload
}
