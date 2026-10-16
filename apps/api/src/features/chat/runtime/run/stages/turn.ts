/**
 * Stage 2 — turn: who speaks, on which model, from which turn state.
 *
 * Every later stage prices, budgets and routes against the model chosen here, so a run with
 * no admissible agent or no model fails now, before any prompt input is assembled for a call
 * that cannot happen. A recovered provider connection is persisted before anything reads the
 * route, so the UI, the usage rows and the next run all see one connection rather than the
 * stale one the session row still names.
 */
import { AgentRunError } from '@localixai/agent/agents'
import { findCatalogModel } from '@localixai/agent/catalog'
import { agentModelSettingsFor } from '@localixai/agent'

import { toSessionSummary } from '../../../repository'
import { agentRoute } from '../../../session-route'
import { loadUserSettingsContext } from '../../../../user/runtime-settings'
import { getAgentService } from '../../agent-service-binding'
import { invocationHost } from '../../execution-context'
import { sessionAgent } from '../../message-envelope'
import { invocationApprovalRequester } from '../invocation-approval'
import {
  persistReboundConnection,
  rebindResolvedProvider,
  resolveRunModel,
} from '../model-selection'
import { prepareTurnState } from '../prepare-turn-state'
import { requireRunAgent } from '../require-run-agent'
import type { RunFrame } from './frame'

export type ResolvedTurn = Awaited<ReturnType<typeof resolveRunTurn>>

export async function resolveRunTurn(frame: RunFrame) {
  const { env, params, userId, speakerAgentId, assistantMessageId } = frame
  const { deps, repo, now } = env
  const initialSession = frame.session
  if (!initialSession.agents.length || initialSession.agents.some((agent) => !agent.agentId)) {
    throw new AgentRunError('AGENT_UNAVAILABLE', 'Session has no valid agent assignment')
  }
  const speaker = sessionAgent(initialSession, speakerAgentId)
  const invocation = invocationHost(params.scope.executionContext.invocation)
  const admittedAgent = await requireRunAgent(
    getAgentService()?.resolveRunAgent,
    userId,
    speakerAgentId,
    invocation,
    initialSession.projectId,
    invocationApprovalRequester({
      hitlRegistry: deps.hitlRegistry,
      streamRegistry: deps.streamRegistry,
      userId,
      session: initialSession,
      hitlTargetSessionId: frame.hitl.targetSessionId,
      assistantMessageId,
      host: invocation,
      signal: frame.abort.signal,
    }),
  )
  frame.assertAdmitted()
  // Reuse the history already handed to this run; only its mutable assistant row is re-read.
  const { state, turnIdleMs } = await prepareTurnState({
    repo,
    userId,
    sessionId: initialSession.id,
    agent: speaker,
    assistantMessageId,
    historyMessages: params.historyMessages,
    now,
  })

  if (!frame.speakerRoute.modelId) {
    throw new AgentRunError('NO_MODEL', 'No model selected for this session')
  }

  // The global agent settings (disabled tools, permissions, response defaults) feed both
  // prompt-context assembly and provider resolution, so they load before either.
  const [catalog, { agentSettings: globalAgentSettings }] = await Promise.all([
    deps.catalogService.getCatalog(),
    loadUserSettingsContext(env.userProfileRepo, userId),
  ])

  const model = await resolveRunModel({
    env,
    userId,
    session: initialSession,
    agentId: speakerAgentId,
    state,
    catalog,
  })

  const reboundSession = rebindResolvedProvider(initialSession, model.connection.id, speakerAgentId)
  if (reboundSession !== initialSession) {
    frame.session = reboundSession
    frame.speakerRoute = agentRoute(reboundSession, speakerAgentId)!
    frame.runtimeSession = rebindResolvedProvider(
      frame.runtimeSession,
      model.connection.id,
      speakerAgentId,
    )
    env.state.activeRunSessions.set(reboundSession.id, {
      userId,
      session: frame.runtimeSession,
      agentId: speakerAgentId,
    })
    await persistReboundConnection(
      repo,
      userId,
      reboundSession,
      model.connection.id,
      speakerAgentId,
    )
    deps.streamRegistry.publish(userId, reboundSession.id, {
      type: 'session.updated',
      // The runtime row, not the rebound one: rebinding must not bounce a child/job session's
      // published `running` back to `idle`.
      session: toSessionSummary(frame.runtimeSession),
    })
  }

  // Per-million-token pricing for the usage rows this run writes.
  const catalogModel = findCatalogModel(catalog.models, model.providerId, model.effectiveModelId)
  return {
    admittedAgent,
    state,
    turnIdleMs,
    catalog,
    globalAgentSettings,
    model,
    catalogModel,
    modelCost: catalogModel?.cost,
    // The user's share of the context window for this agent/model; the prompt and view stages
    // budget against the same value so the checkpoint fires at the ceiling the request fits.
    contextPercent: agentModelSettingsFor(
      globalAgentSettings?.agentModelSettings,
      speakerAgentId,
      model.providerId,
      catalogModel?.id ?? model.effectiveModelId,
    )?.contextPercent,
    // What this run's model reads (text, image, …). One fact, two readers: the tool ledger's
    // `model` layer and the history's tool-image replay. Undefined for a model the catalog does
    // not know: the ledger then withholds nothing, and no image is replayed (a provider rejects
    // one the model cannot read).
    modelInput: catalogModel?.inputModalities as readonly string[] | undefined,
  }
}
