import { mcpClientManager } from '../../mcp/client-manager'
import type { RunnerDeps } from './agent-runner-types'
import {
  endCcHookSession,
  endCcHookSessionsOnExit,
  forgetSessionRuntimeState,
  type RuntimeState,
} from './agent-runner-state'
import { waitForRunSettlement } from './stop-session'
import type { createWakeQueue } from './wake-queue'

/**
 * Record the CC-hook `SessionStart` source the session's NEXT run should report (CC re-fires
 * SessionStart after `/clear` → `clear`, and after its compaction → `compact`, which here is a
 * context checkpoint: the view the hooks injected into was rewritten). Dropping the
 * session from `ccHooksStartedSessions` is what makes that next run re-fire SessionStart (and
 * re-inject its context).
 *
 * A `/clear` also ENDS the session it clears, as in Claude Code: its `SessionEnd` hooks run with
 * reason `clear` before the next run's SessionStart. A checkpoint ends nothing.
 */
export function noteNextSessionStartSource(
  state: RuntimeState,
  sessionId: string,
  source: 'clear' | 'compact',
): void {
  if (source === 'clear') endCcHookSession(state, sessionId, 'clear')
  state.ccHooksStartedSessions.delete(sessionId)
  state.ccHooksSessionStartSource.set(sessionId, source)
}

export interface RunnerLifecycleDeps {
  deps: RunnerDeps
  state: RuntimeState
  wakeQueue: ReturnType<typeof createWakeQueue>
}

/**
 * The ends of a session's and of the process's runtime life: forgetting a deleted session, and
 * tearing everything down at server shutdown.
 *
 * Both have to reach state no single run owns. Adapter resources (transport affinity,
 * continuations, debug state) outlive the run that created them, so the runner remembers every
 * durable session id it has run — otherwise shutdown could dispose only the sessions that
 * happen to be active and leak the idle ones.
 */
export function createRunnerLifecycle({ deps, state, wakeQueue }: RunnerLifecycleDeps) {
  const { activeRuns, actionRegistry } = state
  const runtimeSessionIds = new Set<string>()

  const disposeRuntimeSession = async (sessionId: string): Promise<void> => {
    try {
      await deps.agentRuntime.disposeSession(sessionId)
    } catch (error) {
      // Adapter cleanup is best-effort at a lifecycle boundary. A broken socket
      // closer must not prevent deleting the durable session or reaping the rest
      // of the process during shutdown.
      console.warn(`[agent-runner] failed to dispose runtime session ${sessionId}`, error)
    } finally {
      runtimeSessionIds.delete(sessionId)
    }
  }

  return {
    /** Remember a session the runner has run, so shutdown disposes it even once idle. */
    trackRuntimeSession: (sessionId: string): void => {
      runtimeSessionIds.add(sessionId)
    },

    /** Reap all process-lifetime runtime state for a session being DELETED. */
    async forgetSession(userId: string, sessionId: string) {
      forgetSessionRuntimeState(state, sessionId)
      // What the person was told is waiting on them there must not outlive the session.
      deps.notifications?.attention.forgetSession(sessionId)
      await wakeQueue.forget(userId, sessionId)
      await disposeRuntimeSession(sessionId)
    },

    /** Record the SessionStart source for a session's next run (`/clear` path). */
    noteSessionStartSource(sessionId: string, source: 'clear' | 'compact') {
      noteNextSessionStartSource(state, sessionId, source)
    },

    /**
     * Process-wide teardown for server shutdown. Aborts every in-flight run and
     * kills every tracked child process. Background jobs and sub-agents register a
     * `kill` action in actionRegistry that OUTLIVES the run that spawned them (the
     * disposer only fires when the job itself settles), so iterating actionRegistry
     * also reaps orphans whose originating run already completed.
     */
    async shutdown(): Promise<void> {
      // Stop startup hydration/timers and reject new queue admission before the
      // active-run snapshot. Durable rows remain in SQLite for the next process.
      // close() flips its admission gate synchronously, then waits for drains
      // already in flight. Abort active runs in parallel so a drain awaiting its
      // run cannot deadlock shutdown; both must settle before SQLite is destroyed.
      const queueClosed = wakeQueue.close()
      const runs = [...activeRuns.entries()]
      for (const [, abort] of runs) {
        try {
          abort.abort('server-shutdown')
        } catch {
          /* already aborted */
        }
      }
      // Finalizers persist stopped/terminal state through the repository. Do not
      // let the process destroy SQLite while those writes are still in flight.
      await Promise.all(
        runs.map(([sessionId, abort]) => waitForRunSettlement(activeRuns, sessionId, abort)),
      )
      await queueClosed
      // Quitting ends the sessions that are open, as exiting Claude Code does (`SessionEnd`).
      await endCcHookSessionsOnExit(state)
      await Promise.all([...runtimeSessionIds].map(disposeRuntimeSession))
      runtimeSessionIds.clear()
      for (const entry of actionRegistry.values()) {
        const kill = entry.actions.kill
        if (kill && kill.enabled !== false) {
          try {
            kill.execute()
          } catch {
            /* ignore broken/exited child */
          }
        }
      }
      // Close every cached MCP client (kills their stdio child processes).
      await mcpClientManager.disposeAll().catch(() => {})
    },
  }
}
