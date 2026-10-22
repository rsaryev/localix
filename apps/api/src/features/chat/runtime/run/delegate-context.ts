import { randomUUID } from 'node:crypto'

import { agentParticipant } from '../../../../db/participant'
import type { StoredMessagePayload } from '../../../../db/payload'
import type { ChatRepository } from '../../repository'
import { historyAfterBoundary } from '../model-view/view'

/**
 * Copy a conversation into a child started with `context: "conversation"`, as of the turn that
 * delegated, reduced to what a child should carry: what the person and the delegating agent SAID.
 *
 * The first version copied every row, and in a team chat the child inherited its colleagues'
 * replies, a plugin command's instruction to lead a team, and the tool work of every turn — then
 * had to be told which of it was not its business (LOCALIX-23). What stays, as in a Codex fork:
 *
 *   • the current topic only (an earlier topic was released on purpose);
 *   • the person's messages, without invocation bindings — a command's instruction belongs to the
 *     turn it ran in, not to every child after it; attachments and linked context stay;
 *   • the delegating agent's replies as their text alone — no tool calls, results or reasoning;
 *   • nothing else: no other participant, system wake, notice, or the delegating turn still
 *     being written.
 */
export async function copyConversationForDelegate(
  repo: Pick<ChatRepository, 'listMessages' | 'insertMessage'>,
  input: {
    userId: string
    sourceSessionId: string
    childSessionId: string
    delegatingAgentId: string | undefined
    exclude: string[]
  },
): Promise<number> {
  const rows = historyAfterBoundary(
    await repo.listMessages(input.userId, input.sourceSessionId),
  ).rows
  const excluded = new Set(input.exclude)
  const delegator = input.delegatingAgentId ? agentParticipant(input.delegatingAgentId) : null
  let copied = 0
  for (const row of rows) {
    const { uiOnly, systemNotice, promptBlocked } = row.payload
    if (excluded.has(row.id) || uiOnly || systemNotice || promptBlocked) continue
    const payload = carried(row.payload, delegator)
    if (!payload) continue
    const id = randomUUID()
    await repo.insertMessage({
      id,
      sessionId: input.childSessionId,
      userId: input.userId,
      payload: { ...payload, id },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
    copied += 1
  }
  return copied
}

/** The part of one row a child carries, or null when the row is not for it. */
function carried(
  payload: StoredMessagePayload,
  delegator: string | null,
): StoredMessagePayload | null {
  if (payload.role === 'user') {
    if (payload.from !== 'user') return null
    const bindings = payload.bindings?.filter((binding) => binding.kind !== 'invocation')
    const { bindings: _dropped, ...rest } = payload
    if (!payload.content?.trim() && !bindings?.length) return null
    return bindings?.length ? { ...rest, bindings } : rest
  }
  if (!delegator || payload.from !== delegator) return null
  const items = payload.items?.filter((item) => item.type === 'text')
  if (!items?.length) return null
  const { dataParts: _data, ...rest } = payload
  return { ...rest, items }
}
