import { CHAT_STREAM_DATA_TYPES, type ChatLastRequestUsage } from '@localixai/agent'

import type { ModelContextRepository } from '../model-context-repository'
import type { ChatRepository } from '../repository'

/**
 * What the status line's command reads of a conversation's spend and context.
 *
 * The context numbers are the LAST model request's (Claude Code's `context_window`: "from the
 * most recent API response"): `lastRequest` is the newest assistant message that recorded one.
 * Until a request exists, and while a context checkpoint (this runtime's compaction) is in force
 * and no request has followed it, there is none (`compacted`), as `current_usage` is null before
 * the first API call and after `/compact`.
 */
export interface StatusLineUsage {
  totalCost?: number
  /** The last model request by kind; absent before the first one and after a compaction. */
  lastRequest?: ChatLastRequestUsage
  /** A checkpoint was taken and no request has followed it. */
  compacted?: boolean
  /** The context window the run was budgeted against. */
  contextSize?: number
  /** The prompt being answered: the newest user message. */
  promptId?: string
  /**
   * Cache use over the conversation, from the counts its responses reported, and when the cache
   * was last touched: the newest request that recorded one was answered at `lastResponseAt`
   * (epoch ms), and the cache lives an hour rather than five minutes once a write was long.
   */
  cache?: {
    hitRatio: number | null
    writeTokens: number
    observed: boolean
    lastResponseAt?: number
    longLived?: boolean
  }
}

export async function statusLineUsage(
  repo: Pick<ChatRepository, 'getActiveBranchUsage' | 'listRecentVisibleMessages'>,
  modelContext: Pick<ModelContextRepository, 'list'> | undefined,
  userId: string,
  sessionId: string,
): Promise<StatusLineUsage> {
  const [branch, recent] = await Promise.all([
    repo.getActiveBranchUsage(userId, sessionId).catch(() => null),
    repo.listRecentVisibleMessages(userId, sessionId, 6).catch(() => null),
  ])
  // Newest first.
  const messages = recent?.messages ?? []
  const window = messages
    .flatMap((message) => message.payload.dataParts ?? [])
    .find((part) => part.type === CHAT_STREAM_DATA_TYPES.contextWindow)?.data as
    | { fullWindowTokens?: number }
    | undefined
  const assistants = messages.filter((message) => message.payload.role === 'assistant')
  const withUsage = assistants.find((message) => message.payload.usage?.lastRequest)
  const sinceThen = withUsage ? assistants.slice(0, assistants.indexOf(withUsage)) : assistants
  const checkpoints =
    modelContext && sinceThen.length > 0
      ? await modelContext
          .list(
            sessionId,
            sinceThen.map((message) => message.id),
          )
          .catch(() => null)
      : null
  const compacted = sinceThen.some((message) => checkpoints?.get(message.id)?.hasCheckpoint)
  const prompt = messages.find((message) => message.payload.role === 'user')
  const usage = branch?.usage
  const cached = usage?.cachedInputTokens ?? 0
  const written = usage?.cacheWriteTokens ?? 0
  const input = usage?.inputTokens ?? 0
  // When the run ended: its start plus its measured length. The row's own `updatedAt` moves with
  // every later patch (a delegate's result landing, a mark), so it only stands in for a run whose
  // timing is not written yet.
  const runMs = withUsage?.payload.timing?.totalMs
  const started = Date.parse(withUsage?.createdAt ?? '')
  const answered =
    typeof runMs === 'number' && Number.isFinite(started)
      ? started + runMs
      : Date.parse(withUsage?.updatedAt ?? withUsage?.createdAt ?? '')
  return {
    ...(usage?.totalCost !== undefined ? { totalCost: usage.totalCost } : {}),
    ...(withUsage?.payload.usage?.lastRequest && !compacted
      ? { lastRequest: withUsage.payload.usage.lastRequest }
      : {}),
    ...(compacted ? { compacted } : {}),
    ...(window?.fullWindowTokens ? { contextSize: window.fullWindowTokens } : {}),
    ...(prompt ? { promptId: prompt.id } : {}),
    ...(branch && branch.turns > 0
      ? {
          cache: {
            hitRatio: input > 0 ? Math.min(1, cached / input) : null,
            writeTokens: written,
            observed: cached > 0 || written > 0,
            ...(Number.isFinite(answered) ? { lastResponseAt: answered } : {}),
            ...((usage?.cacheWrite1hTokens ?? 0) > 0 ? { longLived: true } : {}),
          },
        }
      : {}),
  }
}
