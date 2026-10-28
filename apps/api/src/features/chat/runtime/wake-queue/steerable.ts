import type { ToolSurface } from '@localixai/agent/agents'

import type { QueueItem } from '../../../../lib/priority-queue'
import { leaseHolder, type WakeQueueSharedState } from './leases'
import { sameSurface, type PendingTurn } from './entry'
import { batchRule, childMessage, joinPoint } from './kinds'

/** What a RUNNING turn may take from its session's queue at a boundary. */
export interface JoinFilter {
  /** The running turn's client surface: a message sent from another one opens its own turn. */
  surface?: ToolSurface
  /** Children's reports may join — offered only once a tool turn has completed. */
  reports?: boolean
}

/** Selection of what a running model may take at its next boundary (`kinds.ts`, `joins`). */
export const createSteerableSelection = (shared: WakeQueueSharedState) => {
  const free = (sessionId: string, item: QueueItem<PendingTurn>) =>
    leaseHolder(shared, sessionId, item.id) === undefined &&
    !item.value.failure &&
    // A caller awaiting the logical terminal outcome must keep this row on the standalone run
    // path; steering is absorbed by another run and cannot provide an independent result.
    !shared.continuationCompletions.has(item.id)

  /**
   * The band a running model may take next, if any. Never leases.
   *
   * One delivery per boundary: the person's message, a delegator's message, or every report to
   * the running delegator at once — held or not, because a delegator that is working can use them
   * now (`holds.ts`). Child reports are offered only when `withReports` (a completed tool turn).
   */
  function nextJoinable(
    sessionId: string,
    filter: JoinFilter,
    withReports = true,
  ): QueueItem<PendingTurn>[] | undefined {
    const q = shared.queues.get(sessionId)
    if (!q || q.size() === 0) return undefined
    const reports = withReports ? filter.reports : undefined
    const candidates = q.list().filter((item) => {
      if (!free(sessionId, item)) return false
      const point = joinPoint(item.value)
      return point === 'boundary' || (point === 'tool-turn' && reports === true)
    })
    const first = candidates[0]
    if (!first) return undefined
    const turn = first.value
    // A turn that cannot join is not taken, and nothing after it is either: skipping ahead
    // would answer a later message before the earlier one, which then runs as its own turn
    // once this run ends.
    if (turn.entry === 'report') {
      if (turn.batch) return candidates.filter((item) => item.value.batch === turn.batch)
      const key = batchRule(turn)!.key
      return candidates.filter(
        (item) =>
          item.value.entry === 'report' && !item.value.batch && batchRule(item.value)?.key === key,
      )
    }
    if (childMessage(turn)) return [first]
    if (turn.entry === 'person' && !sameSurface(turn.toolSurface, filter.surface)) return undefined
    // A batch a drain claimed before replays through the drain, under its own transcript ids
    // (`selection.ts`); taking one of its lines here would deliver it twice or not at all.
    if (turn.batch) return undefined
    return [first]
  }

  /**
   * The id of what this run would take at its next boundary, if anything. The loop asks before
   * each tool call starts, so a waiting message outranks calls chosen without it. Child reports
   * are excluded: they join only at a completed tool turn.
   */
  const peekSteerable = (sessionId: string, filter: JoinFilter = {}): string | undefined =>
    nextJoinable(sessionId, filter, false)?.[0]?.id

  return { nextJoinable, peekSteerable }
}
