/**
 * Re-enter the runner for the next physical segment of a logical run.
 *
 * One owner for the three things every re-entry path used to repeat: releasing this
 * segment's run lease so the next one can register the same session id synchronously
 * (execute-run's finally guards the hand-over), building the params through
 * `reenterParams` so the scope and chain travel whole, and guarding the relaunch.
 *
 * The guard matters: `runner.run()` RETHROWS unless the chain carries a completion, and
 * only the wake queue installs one. A user-initiated run has none, so a relaunch that
 * fails on a recovery path would be an unhandled rejection — FATAL in bun, taking the
 * API server and every session in it down. Two of the five paths had the catch and
 * three did not; now none of them can forget it.
 */
import type { RunChain, RunEnv, RunParams, RunTurn } from './types'
import { reenterParams } from '../run-params'

export interface ReenterRunArgs {
  env: RunEnv
  /** The finishing segment's params — its scope and chain are carried forward. */
  params: RunParams
  /** The finishing segment's abort controller; releases the lease only if it still holds it. */
  abort?: AbortController
  /** What changes for the next segment (usually the reloaded history + a new assistant row). */
  turn: Partial<RunTurn>
  /** The chain patch: a counter bumped, a latch set. */
  chain?: Partial<Omit<RunChain, 'continuation'>>
  /** Log tag naming the path (`checkpoint:overflow`, `transient`, `hook-stop`, …). */
  reason: string
}

/**
 * Release this segment's lease and start the next one. Fire-and-forget by design —
 * the caller reports `continued` and the new segment owns the terminal status.
 */
export function reenterRun(args: ReenterRunArgs): boolean {
  const { env, params, abort, reason } = args
  const { activeRuns, activeRunSessions } = env.state
  const sessionId = params.session.id
  // Every producer can await storage or a hook before reaching this seam. Stop, or a newer
  // lease owner, must still win at the final synchronous handoff to a fresh controller.
  if (abort?.signal.aborted) return false
  const owner = activeRuns.get(sessionId)
  if (abort && owner && owner !== abort) return false
  if (abort === undefined || activeRuns.get(sessionId) === abort) {
    activeRuns.delete(sessionId)
    activeRunSessions.delete(sessionId)
  }
  void env
    .run(reenterParams(params, args.turn, args.chain))
    .catch((relaunchError) =>
      console.warn(
        `[agent-runner] ${reason} relaunch failed for session ${sessionId}`,
        relaunchError,
      ),
    )
  return true
}
