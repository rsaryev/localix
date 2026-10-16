import type { createSessionStreamRegistry } from '../runtime/session-stream-registry'
import type { createChatRepository } from '../repository'
import type { createUsageRepository } from '../../usage/repository'
import * as usageQueries from './usage'
import { readSessionUsageRows } from '../../usage/session-summary'
import { publishSessionUsageSnapshot } from '../runtime/session-usage'

/**
 * Token and cost reporting — the read-only half of the chat service.
 *
 * Every method is a query against `usageRepo` with one exception, and that exception is why the
 * group needs a session-scoped dependency at all: `sessionUsageText` reads the ACTIVE BRANCH's
 * turns as well as the ledger, because a session's cost is what the conversation you can still
 * see cost, not what every abandoned branch ever did.
 */
export interface ChatUsageFacadeDeps {
  repo: ReturnType<typeof createChatRepository>
  usageRepo: ReturnType<typeof createUsageRepository>
  streamRegistry: ReturnType<typeof createSessionStreamRegistry>
  requireSession: (userId: string, id: string) => Promise<unknown>
}

export function createChatUsageFacade({
  repo,
  usageRepo,
  streamRegistry,
  requireSession,
}: ChatUsageFacadeDeps) {
  return {
    usageOverview(userId: string, opts: usageQueries.UsageOverviewOpts) {
      return usageQueries.usageOverview(usageRepo, userId, opts)
    },

    usageLogs(userId: string, opts: usageQueries.UsageLogsOpts) {
      return usageQueries.usageLogs(usageRepo, userId, opts)
    },

    usageKeys(userId: string) {
      return usageQueries.usageKeys(usageRepo, userId)
    },

    refreshSessionUsage(userId: string, sessionId: string): Promise<void> {
      return publishSessionUsageSnapshot({ repo, usageRepo, streamRegistry, userId, sessionId })
    },

    /** Human-readable per-session usage summary (tokens, cache %, cost). */
    async sessionUsageText(userId: string, sessionId: string): Promise<string> {
      await requireSession(userId, sessionId)
      const [turns, ledgerByKind] = await Promise.all([
        repo.getActiveBranchUsage(userId, sessionId),
        readSessionUsageRows(usageRepo, userId, sessionId),
      ])
      return usageQueries.formatSessionUsageFromTurns(turns, ledgerByKind)
    },
  }
}
