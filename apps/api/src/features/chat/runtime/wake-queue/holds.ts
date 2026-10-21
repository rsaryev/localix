/**
 * WHICH QUEUED ENTRIES MAY NOT OPEN A TURN YET — and until when, at the latest.
 *
 * A child's report waits for its siblings: a delegator that handed out three tasks is answered
 * ONCE, when the last of them reports, instead of three times with what it already knew. Codex
 * does the same with its mailbox: a child's result is queued for the parent without starting a
 * turn, and the parent's next turn takes every result at once.
 *
 * Held, not hidden. A delegator that is RUNNING still takes them at its next completed tool turn
 * (`steerable.ts`), because it is working now and can use them now. And none is held past
 * `MAX_REPORT_HOLD_MS`: a sibling that runs for an hour must not keep finished work from its
 * delegator that long. What is still owed is the delegation ledger's to say (`ReportBarrier`);
 * the queue only asks it, and re-asks when it says a report settled.
 */
import type { QueueItem } from '../../../../lib/priority-queue'
import type { ReportBarrier } from '../wake-queue-contracts'
import type { PendingTurn, ReportTurn } from './entry'
import { batchRule } from './kinds'

/** How long a finished child's report may wait for its siblings before it goes alone. */
export const MAX_REPORT_HOLD_MS = 5 * 60_000

export interface HeldEntries {
  ids: ReadonlySet<string>
  /** The earliest moment a held entry is released by age; absent when nothing is held. */
  releaseAt?: number
}

const NOTHING_HELD: HeldEntries = { ids: new Set() }

export function heldEntries(
  sessionId: string,
  listed: readonly QueueItem<PendingTurn>[],
  barrier: ReportBarrier | undefined,
  nowMs: number,
): HeldEntries {
  if (!barrier) return NOTHING_HELD
  // Reports to one delegator are released together or not at all. A band already claimed once
  // (`batch`) is past deciding: it replays as it was.
  const groups = new Map<string, QueueItem<ReportTurn>[]>()
  for (const item of listed) {
    const turn = item.value
    if (turn.entry !== 'report' || turn.batch || turn.failure) continue
    const key = batchRule(turn)!.key
    groups.set(key, [...(groups.get(key) ?? []), item as QueueItem<ReportTurn>])
  }
  const ids = new Set<string>()
  let releaseAt: number | undefined
  for (const group of groups.values()) {
    const queued = new Set(group.map((item) => item.value.report.childSessionId))
    const participant = group[0]!.value.to?.participant
    if (!barrier.awaits(sessionId, participant, queued)) continue
    const oldest = Math.min(...group.map((item) => Date.parse(item.value.queuedAt) || nowMs))
    const deadline = oldest + MAX_REPORT_HOLD_MS
    if (nowMs >= deadline) continue
    for (const item of group) ids.add(item.id)
    releaseAt = Math.min(releaseAt ?? deadline, deadline)
  }
  return ids.size ? { ids, ...(releaseAt !== undefined ? { releaseAt } : {}) } : NOTHING_HELD
}
