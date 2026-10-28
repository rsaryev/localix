import type { SessionWork } from '../contracts'
import type { RuntimeState } from './agent-runner-state'
import { sessionWork } from './work-view'
import type { RoutableSession } from '../../../contracts/session-route'
import { sessionCooldownUntil } from './session-route-cooldown'

/**
 * What the runner can SAY about sessions right now — who is speaking, what is running, what is
 * busy, what background work exists — read straight off the runtime state, never persisted.
 *
 * Kept apart from the operations because every answer here is a snapshot the caller may act
 * on, and two of them are easy to confuse: `isRunning` is an active run only, while `isBusy`
 * also counts a drain that is about to start one. A gate that asked the weaker question would
 * let a send slip into the window between the two.
 */
export function createRunnerStatus(state: RuntimeState) {
  const { activeRuns, work, drainingSessions } = state

  return {
    isRunning: (sessionId: string) => {
      return activeRuns.has(sessionId)
    },

    /**
     * Epoch-ms until which a fire in this conversation would land on an exhausted provider route
     * (set by a failed run's classifier — see run/finalize.ts), or null.
     */
    rateLimitedUntilMs: (session: RoutableSession): number | null => {
      const now = Date.now()
      return sessionCooldownUntil(session, (route) => state.routeCooldowns.until(route, now))
    },

    /** Distinct (userId, sessionId) pairs owning at least one live background job. */
    listSessionsWithBackgroundJobs(): { userId: string; sessionId: string }[] {
      return work.owners()
    },

    /** A session's running background work, as the composer lists it. */
    listWork(userId: string, sessionId: string): SessionWork[] {
      return sessionWork(work, userId, sessionId)
    },

    /** Volatile wait snapshot used by clients to restore live status after reconnect. */
    getTerminalWaits(userId: string, sessionId: string) {
      const waits: { terminalId: string; label?: string }[] = []
      for (const wait of state.terminalWaits.values()) {
        if (wait.userId === userId && wait.sessionId === sessionId) {
          waits.push({ terminalId: wait.terminalId, label: wait.label })
        }
      }
      return waits
    },

    /** Ids of every session with an active run right now (process-wide). */
    runningSessionIds: (): string[] => {
      return [...activeRuns.keys()]
    },

    /** Ids whose cwd is already runtime-owned: an active run OR a wake drain that will promote
     * into one. Anything that MOVES a session's directory must use this stronger roster, so it
     * cannot do so during the pre-active drain window. */
    busySessionIds: (): string[] => {
      return [...new Set([...activeRuns.keys(), ...drainingSessions])]
    },

    /**
     * Busy = a run is active OR a wake is mid-drain. `drainPendingAndRun` adds the
     * session to `drainingSessions` synchronously but only sets `activeRuns` several
     * awaits later, so checking `isRunning` alone leaves a window where a concurrent
     * user `sendMessage` thinks the session is idle, runs directly, then has its run
     * rejected as "already running" — silently dropping the user's message
     * (observed: a user "?" got no reply mid board-wake). Gate sends on this instead.
     */
    isBusy(sessionId: string) {
      return activeRuns.has(sessionId) || drainingSessions.has(sessionId)
    },
  }
}
