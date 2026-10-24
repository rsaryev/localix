import { CHAT_STREAM_DATA_TYPES } from '@localixai/agent'

import type { ChatRepository } from '../repository'
import type { StatusLineUsage } from './status-line'

/**
 * What the status line's command reads of a conversation's spend and context: the active branch's
 * cost and tokens (`getActiveBranchUsage`), and the context window the last run measured, from
 * its terminal diagnostics on the newest assistant message.
 */
export async function statusLineUsage(
  repo: Pick<ChatRepository, 'getActiveBranchUsage' | 'listRecentVisibleMessages'>,
  userId: string,
  sessionId: string,
): Promise<StatusLineUsage> {
  const [branch, recent] = await Promise.all([
    repo.getActiveBranchUsage(userId, sessionId).catch(() => null),
    repo.listRecentVisibleMessages(userId, sessionId, 6).catch(() => null),
  ])
  const window = recent?.messages
    .flatMap((message) => message.payload.dataParts ?? [])
    .find((part) => part.type === CHAT_STREAM_DATA_TYPES.contextWindow)?.data as
    | { fullWindowTokens?: number; activeTokens?: number }
    | undefined
  const usage = branch?.usage
  return {
    ...(usage?.totalCost !== undefined ? { totalCost: usage.totalCost } : {}),
    ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(window
      ? {
          context: {
            ...(window.activeTokens !== undefined ? { used: window.activeTokens } : {}),
            ...(window.fullWindowTokens !== undefined ? { size: window.fullWindowTokens } : {}),
          },
        }
      : {}),
  }
}
