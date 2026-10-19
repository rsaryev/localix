/**
 * Queue entries for tests, built the way admission builds them (`createPendingTurn`), so a test
 * exercises the same shapes the queue holds in production.
 */
import type { ParticipantRef } from '../../../../db'
import type { QueueItem } from '../../../../lib/priority-queue'
import { sessionFixture } from '../../../../testing/session-fixture'
import type { EnqueueParams } from '../wake-queue-contracts'
import { createPendingTurn, type PendingTurn } from './entry'

const session = sessionFixture({ id: 'entries' })

export const QUEUED_AT = '2026-10-19T00:00:00.000Z'

export function entry(
  id: string,
  params: Partial<Omit<EnqueueParams, 'session' | 'userId'>>,
  priority = 10,
): QueueItem<PendingTurn> {
  return {
    id,
    priority,
    value: createPendingTurn(
      { userId: session.userId, session, content: id, ...params },
      QUEUED_AT,
    ),
  }
}

/** The person's message, typed into a busy session. */
export const person = (id: string, content = id, extra: Partial<EnqueueParams> = {}) =>
  entry(id, { content, internal: false, source: 'user-busy', ...extra }, 0)

/** A child's report to `participant` (`delegationReportWake`). */
export const report = (id: string, participant: string, childSessionId = id) =>
  entry(id, {
    source: 'subagent',
    to: { participant: participant as ParticipantRef },
    report: { label: id, childSessionId, runId: `${id}-run`, status: 'completed', text: id },
  })

/** A machine wake; `coalesce` makes it one of a stream. */
export const event = (id: string, extra: Partial<EnqueueParams> = {}) =>
  entry(id, { source: 'bg-monitor', ...extra })

export const ids = (items: readonly QueueItem<PendingTurn>[]) => items.map((item) => item.id)
