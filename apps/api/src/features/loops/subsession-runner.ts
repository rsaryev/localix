import { randomUUID } from 'node:crypto'
import { errorMessage } from '../../lib/errors'
import type { LoopFireOutcome, SessionLoop } from './contracts'
import { handoffFromFinalText } from './handoff'
import type { RunInvocation } from '../chat/runtime/execution-context'

/**
 * Subsession fire path for loops with `target: 'subsession'`: each fire runs the
 * loop's prompt in a freshly created job session parented to
 * the owning session), so the parent's history stays flat no matter how often the
 * loop fires. The child inherits the parent's provider, model and project.
 *
 * Concurrency is bounded two ways:
 *   - per-loop: a fire is SKIPPED while that loop's previous subsession run is
 *     still in flight (no pile-up of identical children);
 *   - global: at most `concurrency` child runs at once — extra fires wait in a
 *     FIFO promise chain (deliberately NOT p-queue: two counters and an array
 *     are inspectable and dependency-free at this scale).
 */

export interface SubsessionRunnerDeps {
  /**
   * Parent-session fields the child inherits — the route of `agentId` when the loop has an owner,
   * else the conversation's. Null when the parent (or that agent) is gone.
   */
  getParentSession: (
    userId: string,
    sessionId: string,
    agentId?: string,
  ) => Promise<{
    providerConnectionId: string | null
    modelId: string | null
    projectId: string
  } | null>
  createSession: (
    userId: string,
    input: {
      title: string
      parentSessionId: string
      sessionKind: 'job'
      sourceToolCallId: string
      provenance: { kind: 'loop'; parentSessionId: string; loopId: string }
      /** The agent that runs the round: the loop's owner, never another agent. */
      agents?: Array<{ agentId: string }>
      providerConnectionId?: string | null
      modelId?: string
      projectId?: string
    },
  ) => Promise<{ id: string }>
  /** Run the prompt in the child and BLOCK until the run completes (wait: true). */
  runJobTask: (
    userId: string,
    sessionId: string,
    task: string,
    opts: {
      extraDisabledTools?: string[]
      wait: boolean
      invocation: Exclude<RunInvocation, { kind: 'root' }>
    },
  ) => Promise<unknown>
  /** Runtime status of the finished child — distinguishes failed/stopped from completed. */
  childRuntimeStatus: (sessionId: string) => Promise<string | null>
  /**
   * The finished child's final reply — what the next round inherits. Absent in compositions
   * that carry none — the loop then simply inherits nothing.
   */
  childFinalText?: (userId: string, sessionId: string) => Promise<string | null>
  /** Max concurrent child runs across all loops. Default 3. */
  concurrency?: number
  logger?: { warn: (msg: string) => void }
}

export function createSubsessionRunner(deps: SubsessionRunnerDeps) {
  const maxConcurrent = Math.max(1, deps.concurrency ?? 3)
  const inFlightLoops = new Set<string>()
  let running = 0
  const waiters: Array<() => void> = []

  const acquire = async (): Promise<void> => {
    if (running < maxConcurrent) {
      running += 1
      return
    }
    await new Promise<void>((resolve) => waiters.push(resolve))
    running += 1
  }
  const release = (): void => {
    running -= 1
    waiters.shift()?.()
  }

  /** Fire one loop in a fresh child session. Resolves with the outcome for the loop's run stats. */
  return async function fireInSubsession(
    loop: SessionLoop,
    content: string,
    extraDisabledTools: string[],
  ): Promise<LoopFireOutcome> {
    if (inFlightLoops.has(loop.id)) {
      // DECLINED, not failed: a loop whose child outlives its own cadence is the healthy case for a
      // long task on a short cron. Marked `skipped` so the engine neither reports `lastStatus:'error'`
      // nor counts it toward the failure backoff — both of which punished exactly that loop.
      return {
        ok: false,
        skipped: true,
        error: 'skipped — the previous subsession run of this loop is still in flight',
      }
    }
    inFlightLoops.add(loop.id)
    await acquire()
    try {
      const parent = await deps.getParentSession(loop.userId, loop.sessionId, loop.ownerAgentId)
      if (!parent)
        return {
          ok: false,
          error: 'owning session (or the agent that armed the loop) no longer exists',
        }
      const child = await deps.createSession(loop.userId, {
        title: `loop: ${loop.prompt.slice(0, 60)}`,
        parentSessionId: loop.sessionId,
        sessionKind: 'job',
        sourceToolCallId: `loop-${loop.id}-${randomUUID().slice(0, 8)}`,
        provenance: { kind: 'loop', parentSessionId: loop.sessionId, loopId: loop.id },
        // An agent's loop runs as that agent, on its own route: a round must not start a
        // different agent (the default one) on the owner's behalf. A person's loop keeps the
        // conversation's default.
        ...(loop.ownerAgentId ? { agents: [{ agentId: loop.ownerAgentId }] } : {}),
        providerConnectionId: parent.providerConnectionId,
        ...(parent.modelId ? { modelId: parent.modelId } : {}),
        projectId: parent.projectId,
        // Share the parent's working tree so
        // the loop operates on the same files the user watches in the parent.
      })
      await deps.runJobTask(loop.userId, child.id, content, {
        extraDisabledTools,
        wait: true,
        invocation: {
          kind: 'loop-subsession',
          parentSessionId: loop.sessionId,
          loopId: loop.id,
        },
      })
      const status = await deps.childRuntimeStatus(child.id)
      if (status && status !== 'completed') {
        return { ok: false, error: `subsession ${child.id} ended ${status}` }
      }
      // A round that said nothing is not a failure: the loop keeps running and the next round
      // inherits nothing, exactly as the first one does.
      const handoff = handoffFromFinalText(await deps.childFinalText?.(loop.userId, child.id))
      return handoff ? { ok: true, handoff } : { ok: true }
    } catch (err) {
      const msg = errorMessage(err)
      deps.logger?.warn(`loop ${loop.id} subsession fire failed: ${msg}`)
      return { ok: false, error: msg }
    } finally {
      release()
      inFlightLoops.delete(loop.id)
    }
  }
}
