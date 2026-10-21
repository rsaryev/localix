import type { RuntimeState } from './agent-runner-state'
import { runtimeRunAdmission } from './run-admission'
import type { RunCompletion, RunExecutionOutcome } from './run-outcome'
import { stopSession, type StopSessionContext } from './stop-session'
import type { createWakeQueue } from './wake-queue'
import type { EnqueueParams } from './wake-queue-contracts'

export interface RunnerQueueDeps {
  state: RuntimeState
  wakeQueue: ReturnType<typeof createWakeQueue>
  stopCtx: StopSessionContext
}

/**
 * The runner's QUEUE surface: admitting a turn, taking one back, stopping what runs, and
 * holding a session idle while something outside a run changes it.
 *
 * They live together because each one has to agree with the others about one fact — who owns a
 * session's drain right now. A wake admitted while an idle lease is held must queue behind it;
 * a cancelled wake already carried into a run must stop that run and nothing else; a "send now"
 * must stop the run without opening a gap in which the promoted row is gone. The wake queue owns
 * the lease, so every one of these goes through it rather than around it.
 */
export function createRunnerQueue({ state, wakeQueue, stopCtx }: RunnerQueueDeps) {
  const { activeRuns, drainingSessions } = state

  return {
    enqueueRun: wakeQueue.enqueueRun,
    cancelAgentTurns: wakeQueue.cancelAgentTurns,
    cancelAgentTurn: wakeQueue.cancelAgentTurn,

    /**
     * Reserve an idle session across an awaited cwd mutation. Reusing the drain
     * lease makes every concurrent wake queue behind this boundary instead of
     * starting with the old workspace snapshot. The release explicitly retries
     * the drain because an enqueue attempted while leased intentionally no-ops.
     */
    async withSessionIdleLease<T>(
      sessionId: string,
      fn: () => Promise<T>,
    ): Promise<{ acquired: true; value: T } | { acquired: false }> {
      if (activeRuns.has(sessionId) || drainingSessions.has(sessionId)) {
        return { acquired: false }
      }
      drainingSessions.add(sessionId)
      try {
        return { acquired: true, value: await fn() }
      } finally {
        drainingSessions.delete(sessionId)
        wakeQueue.scheduleDrain(sessionId)
      }
    },

    /**
     * Is someone waiting to be heard in this session?
     *
     * A group turn asks this between speakers: a room with three members answers for as long as
     * all three take, and a person who typed "stop" in the middle of that should not have to
     * sit through the rest of it. The queue is the authority on "there is a newer turn" — the
     * same pending-work fact every continuation yields to.
     */
    hasQueuedTurn(sessionId: string) {
      return Promise.resolve(wakeQueue.hasPending(sessionId))
    },

    /**
     * "Push" a session: queue a message and (re)start a run when the session is
     * idle. If a run is active, the message waits and is drained when that run
     * finishes (run/run-teardown.ts drains the queue). Used by async
     * sub-agent completion and background-job completion to feed results back
     * without the owner hanging.
     */
    wake(
      params: Omit<EnqueueParams, 'agentTurn'> & {
        /** Logical-run observer propagated across queued continuations. */
        completion?: RunCompletion
      },
    ): Promise<void> {
      return wakeQueue
        .wake(params, params.completion ? { continuation: params.completion } : undefined)
        .then(() => undefined)
    },

    /**
     * Enqueue an internal turn and resolve when its run envelope reaches a
     * terminal outcome. Scheduler integrations use this instead of treating
     * durable queue admission as successful agent work.
     */
    async wakeAndWait(
      params: Omit<EnqueueParams, 'agentTurn' | 'command'>,
    ): Promise<RunExecutionOutcome> {
      const outcome = await wakeQueue.wake(params, { waitForCompletion: true })
      if (!outcome) {
        return {
          status: 'failed',
          kind: 'fatal',
          message: 'Wake was admitted without a completion outcome.',
          retryable: false,
          rateLimited: false,
        }
      }
      return outcome
    },

    /** Remove a queued message, returning full content only after cancellation wins. */
    removeQueued(
      userId: string,
      sessionId: string,
      itemId: string,
      options?: { wholeBatch?: boolean },
    ) {
      return wakeQueue.remove(userId, sessionId, itemId, options)
    },

    /** Reserve one queued user/control row, stop the exact active run, and hand
     * the row directly to the durable drain without exposing its payload to a
     * client or opening a remove-before-stop gap. */
    interruptAndPromoteQueued(userId: string, sessionId: string, itemId: string) {
      return wakeQueue.interruptAndPromote(userId, sessionId, itemId, () =>
        stopSession(stopCtx, sessionId, 'replace-run'),
      )
    },

    clearQueued(userId: string, sessionId: string) {
      return wakeQueue.clear(userId, sessionId)
    },

    /** Snapshot of the session's pending queue (for list/detail hydration). */
    listQueued(sessionId: string) {
      return Promise.resolve(wakeQueue.list(sessionId))
    },

    /**
     * Withdraw ONE delivery: removed while it waits, or its run aborted while it runs — and
     * nothing else of the session's. A queue item's id is its delivery key.
     */
    async cancelWake(
      userId: string,
      sessionId: string,
      deliveryKey: string,
    ): Promise<'removed' | 'stopped' | 'absent'> {
      // A wake claimed in a batch is one delivery with the batch: it is withdrawn with it.
      const removal = await wakeQueue.remove(userId, sessionId, deliveryKey, { wholeBatch: true })
      if (removal.removed) return 'removed'
      // Leased means a drain or a steer carried it into the run in flight.
      if (removal.reason !== 'leased') return 'absent'
      await stopSession(stopCtx, sessionId, 'cancel-wake')
      return 'stopped'
    },

    /** Called with a session id each time its drain goes idle — nothing left to run. */
    onSessionIdle(listener: (sessionId: string) => void): () => void {
      return wakeQueue.subscribe((event) => {
        if (event.kind === 'idle') listener(event.key)
      })
    },

    /** Stop a session — live run, sub-agent child, or a stale persisted row. */
    async stop(sessionId: string): Promise<boolean> {
      const active = state.activeRunSessions.get(sessionId)
      if (active) await wakeQueue.cancelAgentTurns(active.userId, sessionId)
      return stopSession(stopCtx, sessionId)
    },

    withSessionsQuiesced<T>(ids: readonly string[], operation: () => Promise<T>): Promise<T> {
      return runtimeRunAdmission(state).quiesce(ids, operation)
    },
  }
}
