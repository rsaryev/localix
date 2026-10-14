import type { QueueItem } from '../../../../lib/priority-queue'
import type { PendingTurn, WakeQueueSharedState } from './leases'
import { isBoundaryDeliverable, isDelegatorMessage } from './leases'
import { hasExecutionOverrides } from '../wake-queue-selection'

/** A completed child report may join its delegator's next model sample after a full tool turn.
 * Other machine wakes still own separate runs; this predicate never changes the public
 * next-turn delivery hint or the ordinary user-steering path. */
const isSubagentReport = (turn: PendingTurn): boolean =>
  turn.kind === 'wake' &&
  turn.internal &&
  turn.source === 'subagent' &&
  !turn.agentTurn &&
  !turn.bindings?.length &&
  !hasExecutionOverrides(turn)

export interface SubagentSteeringAddress {
  participant: string
  allowUnaddressed: boolean
}

/** Selection of the queued item a running model may take at its next boundary. */
export const createSteerableSelection = (shared: WakeQueueSharedState) => {
  /**
   * The id of a person's message this run would take at its next boundary, if one waits. The
   * loop asks before each tool call starts, so the message outranks calls chosen without it.
   * Child reports are excluded: they join only at a completed tool turn.
   */
  const peekSteerable = (
    sessionId: string,
    accepts?: (content: string) => boolean,
    address?: SubagentSteeringAddress,
  ): string | undefined => nextSteerable(sessionId, accepts, address, false)?.id

  /** The one queued item the running model may take next, if any. Never leases. */
  function nextSteerable(
    sessionId: string,
    accepts?: (content: string) => boolean,
    subagent?: SubagentSteeringAddress,
    reports = true,
  ): QueueItem<PendingTurn> | undefined {
    const q = shared.queues.get(sessionId)
    if (!q || q.size() === 0) return undefined
    const leased = shared.leasedSteeringIds.get(sessionId)
    const steerable = q
      .list()
      .filter(
        (it) =>
          !leased?.has(it.id) &&
          !shared.leasedDrainIds.get(sessionId)?.has(it.id) &&
          // A caller awaiting the logical terminal outcome must keep this row
          // on the standalone run path; steering is absorbed by another run and
          // cannot provide an independent completion result.
          !shared.continuationCompletions.has(it.id) &&
          // Deliver one eligible item per model-turn boundary. The extra report
          // predicate is opt-in and never changes what the ordinary queue drains.
          (isBoundaryDeliverable(it.value) || (reports && subagent && isSubagentReport(it.value))),
      )
      .slice(0, 1)
    const first = steerable[0]
    if (!first) return undefined
    // A message the running participant is not addressed by is not taken — and nothing after
    // it is either: skipping ahead would answer a later message before the earlier one, which
    // then runs as its own turn once this run ends.
    // A delegator's message is for the child's one agent, and taking it is its only way in.
    if (first.value.kind === 'wake' && !isDelegatorMessage(first.value)) {
      const recipient = first.value.to?.participant
      if (
        !subagent ||
        (recipient ? recipient !== subagent.participant : !subagent.allowUnaddressed)
      )
        return undefined
    } else if (accepts && !accepts(first.value.content)) return undefined
    return first
  }

  return { nextSteerable, peekSteerable }
}
