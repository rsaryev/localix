import { randomUUID } from 'node:crypto'

import type { ChatRepository } from '../../repository'
import { historyAfterBoundary } from '../model-view/view'

/**
 * Copy a conversation into a forked child, as of the turn that forked it.
 *
 * The same copy `/fork` makes (`service/session-fork.ts`), narrowed to what the forked agent
 * should carry: the current topic only (an earlier topic was released on purpose), no UI-only
 * rows or notices, and none of the forking turn's own rows that are still being written. Rows
 * keep their authors, so the child's participant view gives the agent its own words and tool
 * work and its colleagues' public text — the same view it had in the parent.
 */
export async function copyConversationForFork(
  repo: Pick<ChatRepository, 'listMessages' | 'insertMessage'>,
  input: { userId: string; sourceSessionId: string; childSessionId: string; exclude: string[] },
): Promise<number> {
  const rows = historyAfterBoundary(
    await repo.listMessages(input.userId, input.sourceSessionId),
  ).rows
  const excluded = new Set(input.exclude)
  let copied = 0
  for (const row of rows) {
    if (excluded.has(row.id) || row.payload.uiOnly || row.payload.systemNotice) continue
    const id = randomUUID()
    await repo.insertMessage({
      id,
      sessionId: input.childSessionId,
      userId: input.userId,
      payload: { ...row.payload, id },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
    copied += 1
  }
  return copied
}
