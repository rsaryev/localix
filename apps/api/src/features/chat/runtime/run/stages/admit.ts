/**
 * Stage 1 — admit: claim the session's run slot and announce the run.
 *
 * Two runs on one session would interleave writes into the same assistant row, so the slot
 * (`activeRuns`) is claimed here before anything else touches durable state, and a slot whose
 * first durable write fails is released on the spot — otherwise the session would read as
 * running forever with nothing behind it. Everything past this stage runs inside the
 * orchestrator's try/finally, whose teardown releases the slot.
 */
import { AgentRunError } from '@localixai/agent/agents'

import { agentRoute } from '../../../session-route'
import type { SessionRecord } from '../../../repository'
import { publishAgentPhase } from '../../session-stream-registry'
import { identityOf, identityOutlivesRun } from '../../run-params'
import { resolveRunHitlRouting } from '../hitl-reachable'
import { createRunSessionSnapshot } from '../session-snapshot'
import { ensureSessionStores } from '../session-stores'
import { trackChildRun } from '../subagent-work'
import type { RunEnv, RunParams } from '../types'
import type { RunFrame } from './frame'
import { historyAfterBoundary } from '../../model-view/view'

export async function admitRun(
  env: RunEnv,
  incoming: RunParams,
  assertAdmitted: () => void,
): Promise<RunFrame> {
  // Cut before prompt inputs, hooks and system bindings read the transcript, not only on the wire.
  const history = historyAfterBoundary(incoming.historyMessages)
  const params = {
    ...incoming,
    historyMessages: history.rows,
    ...(history.clearId ? { contextBoundaryId: history.clearId } : {}),
  }
  const { deps, repo, state: runtimeState } = env
  const { activeRuns, activeRunSessions } = runtimeState
  const { userId, session, assistantMessageId } = params
  const speakerAgentId = params.scope.speakerAgentId
  const speakerRoute = agentRoute(session, speakerAgentId)
  if (!speakerRoute) {
    throw new AgentRunError(
      'AGENT_UNAVAILABLE',
      `Agent is no longer in the conversation: ${speakerAgentId}`,
    )
  }
  const loadSessionSnapshot = createRunSessionSnapshot(repo, userId)
  const { targetSessionId, reachable } = resolveRunHitlRouting(
    session,
    userId,
    session.parentSessionId ? await loadSessionSnapshot() : [],
  )

  assertAdmitted()
  const stores = ensureSessionStores(runtimeState, {
    sessionId: session.id,
    agentId: speakerAgentId,
  })
  if (activeRuns.has(session.id)) {
    throw new Error(`Session ${session.id} is already running`)
  }

  const abort = new AbortController()
  activeRuns.set(session.id, abort)
  activeRunSessions.set(session.id, { userId, session, agentId: speakerAgentId })
  // Runtime children retain their dispatched role across wakes.
  if (identityOutlivesRun(session)) {
    runtimeState.sessionRunIdentity.set(session.id, identityOf(params.scope))
  }

  const publishRuntimeSession = async (status: SessionRecord['runtimeStatus']) => {
    frame.runtimeSession = await env.markRuntimeSessionStatus(userId, frame.runtimeSession, status)
    activeRunSessions.set(session.id, {
      userId,
      session: frame.runtimeSession,
      agentId: speakerAgentId,
    })
  }
  const frame: RunFrame = {
    env,
    params,
    userId,
    speakerAgentId,
    assistantMessageId,
    assertAdmitted,
    abort,
    isContinuation: params.chain.continuation,
    session,
    speakerRoute,
    runtimeSession: session,
    publishRuntimeSession,
    publishPhase: (phase) =>
      publishAgentPhase(deps.streamRegistry, userId, session.id, phase, true),
    loadSessionSnapshot,
    hitl: { targetSessionId, reachable },
    stores,
    steerCtxRef: { current: null },
    budget: {},
    providerAttemptStarted: false,
    teardown: { pluginHooks: [], liveResolverKeys: new Set<string>() },
  }

  try {
    await publishRuntimeSession('running')
  } catch (err) {
    if (activeRuns.get(session.id) === abort) {
      activeRuns.delete(session.id)
      activeRunSessions.delete(session.id)
    }
    throw err
  }
  // A delegated child's run shows in its parent's work strip, with a Stop, however it began.
  trackChildRun(env.state, userId, session)
  deps.streamRegistry.publish(userId, session.id, {
    type: 'run.started',
    sessionId: session.id,
    messageId: assistantMessageId,
    agentId: speakerAgentId,
  })
  if (!frame.isContinuation) frame.publishPhase('connecting')
  return frame
}
