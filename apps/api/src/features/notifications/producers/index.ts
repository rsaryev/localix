import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../../db/types'
import type { WorkRecord } from '../../work/contracts'
import type { WorkRegistry } from '../../work/registry'
import { createAttentionRegistry, type AttentionRegistry } from '../../attention/registry'
import {
  hitlAttention,
  mentionAttention,
  planAttention,
  questionAttention,
  type HitlLifecycleObserver,
  type MentionAttention,
  type PlanAttention,
  type QuestionAttention,
} from '../../attention/sources'
import type { ProviderConditions } from '../conditions/providers'
import type { NotificationJournal } from '../journal'
import { mirrorAttentionToJournal } from './attention'
import { settleStaleRequests } from './boot'
import { createOrderedLane, type LookupSession } from './facts'
import { createPlanNotifications, type PlanNotifications } from './plans'
import { createRunNotifications, type RunNotifications } from './runs'
import { createWorkNotifications, type WorkNotifications } from './work'
import type { QuestionRegistry } from '../../questions/registry'

/**
 * THE SERVER'S AGENT-LIFECYCLE PRODUCERS, as one bag the composition root threads to the seams.
 *
 * Each seam (a run's logical end, the HITL registry, a handback, the work registry, a terminal
 * exit) holds only an optional reference to its member and calls it with what it already knows;
 * the rules — what raises, what is suppressed, what settles what — live in these modules alone.
 * One ordered lane is shared by all of them, so facts reach the journal in the order they happened
 * even when one needed an async session lookup first.
 *
 * What waits on the PERSON (`hitl`, `questions`, `mentions`, the plan's review in `plans`) is not
 * written here directly: those members are attention sources, and their rows come from the one
 * mirror of the attention registry (`./attention.ts`).
 */
export interface AgentNotifications {
  runs: RunNotifications
  hitl: HitlLifecycleObserver
  mentions: MentionAttention
  work: WorkNotifications
  questions: QuestionAttention
  plans: PlanAttention & PlanNotifications
  /** The one "waiting on you" registry the four sources above raise into. */
  attention: AttentionRegistry
  /** Resolves once every fact handed over so far is queued in the journal. */
  idle(): Promise<void>
}

export function createAgentNotifications(deps: {
  journal: NotificationJournal
  /** The process's one registry; a narrow host (a test) gets its own. */
  attention?: AttentionRegistry
  lookupSession: LookupSession
  defaultUserId: string
  runningWork: (owner: { userId: string; sessionId: string }) => readonly WorkRecord[]
  provider?: Pick<ProviderConditions, 'runEnded'>
  log?: (event: string, detail: Record<string, unknown>) => void
}): AgentNotifications {
  const lane = createOrderedLane(deps.log)
  const shared = { journal: deps.journal, lane, lookupSession: deps.lookupSession }
  const attention = deps.attention ?? createAttentionRegistry()
  mirrorAttentionToJournal({ ...shared, registry: attention })
  return {
    runs: createRunNotifications({ ...shared, provider: deps.provider }),
    hitl: hitlAttention(attention, deps.defaultUserId),
    mentions: mentionAttention(attention),
    work: createWorkNotifications({ ...shared, runningWork: deps.runningWork }),
    questions: questionAttention(attention),
    plans: { ...planAttention(attention), ...createPlanNotifications(shared) },
    attention,
    idle: () => lane.idle(),
  }
}

/**
 * Build the producers and connect the ones a seam SUBSCRIBES to, in the order boot needs:
 * the work registry's end observer before `work.hydrate()` (its losses are reported through it),
 * and the stale-request settle awaited before anything can raise a new request.
 */
export async function startAgentNotifications(deps: {
  db: Kysely<AppDatabase>
  journal: NotificationJournal
  attention?: AttentionRegistry
  lookupSession: LookupSession
  defaultUserId: string
  work: Pick<WorkRegistry, 'list' | 'onEnded'>
  /** Subscribed before its `hydrate`, like work; a hydrate raises nothing — those rows exist. */
  questions?: Pick<QuestionRegistry, 'onAsked' | 'onResolved'>
  provider?: Pick<ProviderConditions, 'runEnded'>
  log?: (event: string, detail: Record<string, unknown>) => void
}): Promise<AgentNotifications> {
  const notifications = createAgentNotifications({
    ...deps,
    runningWork: (...args) => deps.work.list(...args),
  })
  deps.work.onEnded((...args) => notifications.work.ended(...args))
  deps.questions?.onAsked((record) => notifications.questions.asked(record))
  deps.questions?.onResolved((record) => notifications.questions.closed(record))
  await settleStaleRequests(deps.db, deps.journal)
  return notifications
}

export type { HitlLifecycleObserver } from '../../attention/sources'
export type { LookupSession } from './facts'
export { recordInterruptedRuns, settleStaleRequests } from './boot'
