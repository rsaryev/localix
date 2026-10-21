import type { createDatabase } from '../db'
import { takeInterruptedRuns } from '../db/migrator'
import { createAttentionRegistry } from '../features/attention/registry'
import { rebuildDurableAttention } from '../features/attention/sources'
import type { createChatRepository } from '../features/chat/repository'
import { markLostWorkItems } from '../features/chat/runtime/lost-work'
import type { NotificationJournal } from '../features/notifications'
import type { createProviderConditions } from '../features/notifications/conditions/providers'
import {
  recordInterruptedRuns,
  startAgentNotifications,
  type AgentNotifications,
} from '../features/notifications/producers'
import { createPlanRepository } from '../features/plans/repository'
import type { WorkRegistry } from '../features/work/registry'
import type { loadEnv } from '../lib/env'
import type { createLogger } from '../lib/logger'

/**
 * Restart recovery: what the previous process left in flight is settled and announced before this
 * process can start new work.
 */

export interface BootRecoveryDeps {
  db: ReturnType<typeof createDatabase>
  env: ReturnType<typeof loadEnv>
  logger: ReturnType<typeof createLogger>
  bootRepo: ReturnType<typeof createChatRepository>
  notifications: NotificationJournal
  work: WorkRegistry
  providerConditions: ReturnType<typeof createProviderConditions>
}

export interface BootRecovery {
  /** The server's agent-lifecycle producers into the journal, threaded to their seams. */
  agentNotifications: AgentNotifications
  interruptedRuns: ReturnType<typeof takeInterruptedRuns>
}

export async function recoverBootState({
  db,
  env,
  logger,
  bootRepo,
  notifications,
  work,
  providerConditions,
}: BootRecoveryDeps): Promise<BootRecovery> {
  // The agent-lifecycle producers (`features/notifications/producers`). Started before
  // `hydrate`, whose losses they report, and awaited: a pending question the old process held is
  // settled before this process can ask a new one.
  const lookupSession = (...args: Parameters<typeof bootRepo.getSession>) =>
    bootRepo.getSession(...args)
  const agentNotifications = await startAgentNotifications({
    db,
    journal: notifications,
    attention: createAttentionRegistry({ warn: (msg) => logger.warn({ event: 'attention', msg }) }),
    lookupSession,
    defaultUserId: env.LOCALIX_DEFAULT_USER_ID,
    work,
    provider: providerConditions,
    log: (event, detail) => logger.warn({ event, ...detail }),
  })
  await markLostWorkItems(bootRepo, await work.hydrate(), new Date().toISOString(), {
    warn: (msg) => logger.warn({ event: 'work.lost_item', msg }),
  })
  // A plan presented for review is not lost with the old process: it rejoins the "waiting on
  // you" set from its row.
  await rebuildDurableAttention(agentNotifications.attention, {
    plans: await createPlanRepository(db).listAwaitingReview(),
    getSession: (...args) => bootRepo.getSession(...args),
  })
  // Which sessions had a run in flight, from `agent_runs` — the boot migration already
  // reclassified them. NOT from the session sweep: a chat session never reaches
  // `runtime_status='running'`, so that column only ever sees workers, and the first version of
  // this feature announced nothing at all because of it (found by review). Read once; the note
  // itself has to wait for the chat service, which owns the stream registry.
  const interruptedRuns = takeInterruptedRuns()
  await recordInterruptedRuns({ journal: notifications, lookupSession }, interruptedRuns)

  return { agentNotifications, interruptedRuns }
}
