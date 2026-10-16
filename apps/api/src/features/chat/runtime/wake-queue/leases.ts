import { randomUUID } from 'node:crypto'

import { createPriorityQueue, type PriorityQueue } from '../../../../lib/priority-queue'
import type { RuntimeState } from '../agent-runner-state'
import type { MessageBinding, WakeSource } from '../../contracts'
import type { ToolSurface } from '@localixai/agent/agents'
import type { ParticipantRef } from '../../../../db'
import type { RunExecutionContext } from '../execution-context'
import type { RunCompletion } from '../run-outcome'
import type { DurableQueueItem, WakeQueueStore } from '../wake-queue-store'
import { hasExecutionOverrides } from '../wake-queue-selection'
import type { AgentTurnTicket } from '../agent-turn-ticket'
import type { QueuedCommand } from '../wake-queue-contracts'

export interface PendingTurn {
  userId: string
  content: string
  queuedAt: string
  agentTurn?: AgentTurnTicket
  /** Originating optimistic UI row; correlation only, never a durable message id. */
  clientMessageId?: string
  extraDisabledTools?: string[]
  /** Plugins whose tools the answering turn carries; lands on the turn's row. */
  plugins?: string[]
  /** True = internal turn, hidden from the UI transcript (NOT from the model). */
  internal: boolean
  kind: 'user' | 'wake'
  /** Provenance tag (loop / hook / subagent / …) — orthogonal to `internal`. */
  source?: WakeSource
  /** A slash command queued while the session was busy; see `QueuedCommand`. */
  command?: QueuedCommand
  bindings?: MessageBinding[]
  toolSurface?: ToolSurface
  /** Trusted authority inherited from the run that scheduled this wake. */
  executionContext?: RunExecutionContext
  /**
   * WHICH participant this routed turn concerns, when it concerns one.
   *
   * The participant projection shows a routed report in full to its recipient and as one line
   * to everyone else (`history/stages/participant-view.ts`). Without it a board outcome about one
   * participant's card is delivered whole to every participant — in one live room that was 13.9k
   * characters of board traffic, paid for four times.
   */
  to?: { participant: ParticipantRef; handle?: string }
  /** The person's words this wake is addressed by (`WakeRequest.addressedAs`); durable with it. */
  addressedAs?: string
}

/**
 * Can this queued turn be handed to the ALREADY-RUNNING model at its next boundary
 * (Pi steering, `run/steering.ts`) instead of waiting for a fresh run of its own?
 *
 * One owner for a rule that was spelled out twice — in `toPublic`'s `delivery` hint and in
 * `reserveLocal`'s reservation filter — and the two MUST agree: the composer chip promises
 * `next-tool` on the strength of the same predicate the steering taker applies, so a source
 * added to one copy and not the other either advertises a boundary delivery that never
 * happens or hides one that does.
 *
 * A visible user interjection qualifies, and so does a delegator's message (below). Other
 * machine-produced wakes (sub-agent reports, webhooks, loops) need their own queued turn:
 * injecting one into a run that spawned async work can split its assistant row while late tool
 * updates still belong to the earlier row. Keeping those wakes on the ordinary drain path
 * preserves one owner per response row and gives orchestration reports a clear review turn.
 * Bindings or execution overrides likewise require their own run because they change the
 * turn's shape, not just its text.
 */
export const isBoundaryDeliverable = (turn: PendingTurn): boolean =>
  isDelegatorMessage(turn) ||
  isQuestionAnswer(turn) ||
  (!turn.agentTurn &&
    turn.kind === 'user' &&
    !turn.bindings?.length &&
    !hasExecutionOverrides(turn))

/**
 * A delegator's word to the child running its task (`fork` action message).
 *
 * The one machine wake a RUNNING model may take mid-step: it amends the child's brief, and making
 * the child finish on the stale brief first would waste exactly the work the message exists to
 * redirect. A child with no run gets it the ordinary way — the drain opens a run for it — and that
 * run, like every run of a delegated child, reports to the parent when it ends
 * (`run/child-run-report.ts`).
 */
export const isDelegatorMessage = (turn: PendingTurn): boolean =>
  turn.kind === 'wake' &&
  turn.source === 'delegator' &&
  !turn.agentTurn &&
  !turn.bindings?.length &&
  !hasExecutionOverrides(turn)

/**
 * The person's answer to a question the agent queued (`ask` with `wait: false`).
 *
 * A machine wake only by transport: its content is what the person chose, in reply to the agent,
 * so a run still going should take it at its next step exactly as it takes a typed interjection —
 * an agent that queued a question in order to keep working is the one most likely to still be
 * working when the answer comes, and making it finish first is the wait the queue exists to
 * avoid. Unlike a delegator's message it is ADDRESSED (the participant that asked), so the
 * steering taker still checks the recipient.
 */
export const isQuestionAnswer = (turn: PendingTurn): boolean =>
  turn.kind === 'wake' &&
  turn.source === 'answer' &&
  !turn.agentTurn &&
  !turn.bindings?.length &&
  !hasExecutionOverrides(turn)

export interface WakeQueueSharedState {
  activeRuns: RuntimeState['activeRuns']
  drainingSessions: RuntimeState['drainingSessions']
  queues: Map<string, PriorityQueue<PendingTurn>>
  leasedSteeringIds: Map<string, Set<string>>
  leasedDrainIds: Map<string, Set<string>>
  /** One promotion may borrow the running drain while its durable claim is pending. */
  promotingSessions: Set<string>
  /** A selected send-now row handed to a drain that is already running an agent ticket. */
  pendingPromotions: Map<string, string>
  recoveryTimers: Set<ReturnType<typeof setTimeout>>
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
  leasedSteeringIds: new Map<string, Set<string>>(),
  leasedDrainIds: new Map<string, Set<string>>(),
  promotingSessions: new Set<string>(),
  pendingPromotions: new Map<string, string>(),
  recoveryTimers: new Set<ReturnType<typeof setTimeout>>(),
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

interface LeaseDependencies {
  now: () => string
  store?: WakeQueueStore<PendingTurn>
  scheduleDrain: (sessionId: string) => void
}

export const createLeaseOperations = (
  shared: WakeQueueSharedState,
  { now, store, scheduleDrain }: LeaseDependencies,
) => {
  const leaseOwner = randomUUID()
  const LEASE_MS = 60_000

  const leaseWindow = (): { nowIso: string; expiresIso: string } => {
    const nowIso = now()
    const at = Date.parse(nowIso)
    return {
      nowIso,
      expiresIso: new Date((Number.isFinite(at) ? at : Date.now()) + LEASE_MS).toISOString(),
    }
  }

  const restore = (row: DurableQueueItem<PendingTurn>): void => {
    let q = shared.queues.get(row.sessionId)
    if (!q) {
      q = createPriorityQueue<PendingTurn>()
      shared.queues.set(row.sessionId, q)
    }
    if (!q.list().some((item) => item.id === row.id)) {
      q.enqueue(row.payload, { id: row.id, priority: row.priority })
    }
    if (row.state === 'leased' && row.leaseExpiresAt) {
      const delay = Math.max(0, Date.parse(row.leaseExpiresAt) - Date.now()) + 5
      const timer = setTimeout(() => {
        shared.recoveryTimers.delete(timer)
        scheduleDrain(row.sessionId)
      }, delay)
      timer.unref?.()
      shared.recoveryTimers.add(timer)
    }
  }

  /** One startup barrier: expired leases are released before rows become visible.
   * Every public async mutation awaits it, so restart recovery cannot reorder a
   * concurrent enqueue ahead of an older persisted FIFO row. */
  const ready = store
    ? (async () => {
        let lastError: unknown
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (shared.closed) return
          try {
            await store.recoverExpired(now())
            for (const row of await store.listAll()) restore(row)
            return
          } catch (error) {
            lastError = error
            if (attempt < 2) {
              await new Promise<void>((resolve) => setTimeout(resolve, [25, 100][attempt]))
              if (shared.closed) return
            }
          }
        }
        throw lastError
      })()
    : Promise.resolve()

  const claim = async (userId: string, sessionId: string, ids: readonly string[]) => {
    if (!store) return true
    await ready
    const window = leaseWindow()
    return store.claim(userId, sessionId, ids, leaseOwner, window.nowIso, window.expiresIso)
  }

  const ack = async (userId: string, sessionId: string, ids: readonly string[]) =>
    store ? store.ack(userId, sessionId, ids, leaseOwner) : true

  const release = async (userId: string, sessionId: string, ids: readonly string[]) => {
    if (store) await store.release(userId, sessionId, ids, leaseOwner)
  }

  const isLeased = (sessionId: string, itemId: string): boolean =>
    Boolean(
      shared.leasedSteeringIds.get(sessionId)?.has(itemId) ||
      shared.leasedDrainIds.get(sessionId)?.has(itemId),
    )

  const releaseDrainBand = (sessionId: string, ids: readonly string[]): void => {
    const leased = shared.leasedDrainIds.get(sessionId)
    for (const id of ids) leased?.delete(id)
    if (leased?.size === 0) shared.leasedDrainIds.delete(sessionId)
  }

  const resetDrainRetry = (sessionId: string): void => {
    shared.drainRetryAttempts.delete(sessionId)
    const timer = shared.drainRetryTimers.get(sessionId)
    if (timer) clearTimeout(timer)
    shared.drainRetryTimers.delete(sessionId)
  }

  const scheduleDrainRetry = (sessionId: string): void => {
    if (shared.closed || shared.drainRetryTimers.has(sessionId)) return
    const attempt = shared.drainRetryAttempts.get(sessionId) ?? 0
    if (attempt >= 3) return
    shared.drainRetryAttempts.set(sessionId, attempt + 1)
    const timer = setTimeout(
      () => {
        shared.drainRetryTimers.delete(sessionId)
        scheduleDrain(sessionId)
      },
      [25, 100, 500][attempt] ?? 500,
    )
    timer.unref?.()
    shared.drainRetryTimers.set(sessionId, timer)
  }

  return {
    ready,
    claim,
    ack,
    release,
    isLeased,
    releaseDrainBand,
    resetDrainRetry,
    scheduleDrainRetry,
  }
}

export type LeaseOperations = ReturnType<typeof createLeaseOperations>
