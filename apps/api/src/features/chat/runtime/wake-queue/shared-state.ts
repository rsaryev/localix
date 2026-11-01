import type { PriorityQueue } from '../../../../lib/priority-queue'
import type { RuntimeState } from '../agent-runner-state'
import type { RunCompletion } from '../run-outcome'
import type { PendingTurn } from './entry'

/**
 * WHO HOLDS AN ENTRY: a drain delivering it, or a running turn taking it at a boundary. One holder
 * per entry, kept beside the durable lease (`claim`): an entry anyone holds is not removed,
 * reprioritised, folded into, or offered to anyone else.
 */
export type LeaseHolder = 'drain' | 'steer'

export function holdLeases(
  shared: Pick<WakeQueueSharedState, 'leases'>,
  sessionId: string,
  ids: readonly string[],
  holder: LeaseHolder,
): void {
  const held = shared.leases.get(sessionId) ?? new Map<string, LeaseHolder>()
  for (const id of ids) held.set(id, holder)
  shared.leases.set(sessionId, held)
}

/** Let go of `ids` — only those `holder` holds, when one is named. */
export function dropLeases(
  shared: Pick<WakeQueueSharedState, 'leases'>,
  sessionId: string,
  ids: readonly string[],
  holder?: LeaseHolder,
): void {
  const held = shared.leases.get(sessionId)
  if (!held) return
  for (const id of ids) if (!holder || held.get(id) === holder) held.delete(id)
  if (held.size === 0) shared.leases.delete(sessionId)
}

export const leaseHolder = (
  shared: Pick<WakeQueueSharedState, 'leases'>,
  sessionId: string,
  id: string,
): LeaseHolder | undefined => shared.leases.get(sessionId)?.get(id)

export interface WakeQueueSharedState {
  activeRuns: RuntimeState['activeRuns']
  drainingSessions: RuntimeState['drainingSessions']
  queues: Map<string, PriorityQueue<PendingTurn>>
  /** Session → entry → who holds its in-process lease (`holdLeases`). */
  leases: Map<string, Map<string, LeaseHolder>>
  /** One promotion may borrow the running drain while its durable claim is pending. */
  promotingSessions: Set<string>
  /** A selected send-now row handed to a drain that is already running an agent ticket. */
  pendingPromotions: Map<string, string>
  recoveryTimers: Set<ReturnType<typeof setTimeout>>
  /** One per session: the moment its earliest held report is released by age (`holds.ts`). */
  holdTimers: Map<string, { at: number; timer: ReturnType<typeof setTimeout> }>
  drainRetryTimers: Map<string, ReturnType<typeof setTimeout>>
  drainRetryAttempts: Map<string, number>
  inFlightDrains: Set<Promise<void>>
  continuationCompletions: Map<string, { sessionId: string; completions: Set<RunCompletion> }>
  closed: boolean
}

export const createWakeQueueSharedState = (
  state: Pick<RuntimeState, 'activeRuns' | 'drainingSessions'>,
): WakeQueueSharedState => ({
  activeRuns: state.activeRuns,
  drainingSessions: state.drainingSessions,
  // The manager OWNS the per-session queues (not RuntimeState) — keeping the
  // data structure beside the logic that maintains its invariants.
  queues: new Map<string, PriorityQueue<PendingTurn>>(),
  leases: new Map<string, Map<string, LeaseHolder>>(),
  promotingSessions: new Set<string>(),
  pendingPromotions: new Map<string, string>(),
  recoveryTimers: new Set<ReturnType<typeof setTimeout>>(),
  holdTimers: new Map<string, { at: number; timer: ReturnType<typeof setTimeout> }>(),
  drainRetryTimers: new Map<string, ReturnType<typeof setTimeout>>(),
  drainRetryAttempts: new Map<string, number>(),
  inFlightDrains: new Set<Promise<void>>(),
  // A RunCompletion is process-local control state, never durable queue payload.
  // Keying it by delivery id lets a queued continuation inherit the logical run
  // without serializing Promises or coupling PendingTurn to one runtime engine.
  continuationCompletions: new Map<
    string,
    { sessionId: string; completions: Set<RunCompletion> }
  >(),
  closed: false,
})
