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
import { agentRoute } from '../../../../../contracts/session-route'
import { loadUserSettingsContext } from '../../../../user/runtime-settings'
import { awaitAgentService } from '../../agent-service-binding'
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
import type { RunStanding } from './policy'

export type ResolvedTurn = Awaited<ReturnType<typeof resolveRunTurn>>

export async function resolveRunTurn(frame: RunFrame, standing: RunStanding) {
  const { env, params, userId, agentId, assistantMessageId } = frame
  const { deps, repo, now } = env
  const initialSession = frame.session
  if (!initialSession.agent?.agentId) {
    throw new AgentRunError('AGENT_UNAVAILABLE', 'Session has no valid agent assignment')
  }
  const answering = sessionAgent(initialSession)
  const invocation = standing.policy.invocation.admissionHost
  const admittedAgent = await requireRunAgent(
    (await awaitAgentService())?.resolveRunAgent,
    userId,
    agentId,
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
    agent: answering,
    assistantMessageId,
    historyMessages: params.historyMessages,
    now,
  })

  if (!frame.route.modelId) {
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
    agentId,
    state,
    catalog,
  })

  const reboundSession = rebindResolvedProvider(initialSession, model.connection.id)
  if (reboundSession !== initialSession) {
    frame.session = reboundSession
    frame.route = agentRoute(reboundSession)!
    frame.runtimeSession = rebindResolvedProvider(frame.runtimeSession, model.connection.id)
    env.state.activeRunSessions.set(reboundSession.id, {
      userId,
      session: frame.runtimeSession,
    })
    await persistReboundConnection(repo, userId, reboundSession, model.connection.id)
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
    ...standing,
    admittedAgent,
    state,
    turnIdleMs,
    catalog,
    globalAgentSettings,
    model,
    catalogModel,
    modelCost: catalogModel?.cost,
    // The person's context limit for this agent/model; the prompt and view stages
    // budget against the same value so the checkpoint fires at the ceiling the request fits.
    contextLimit: agentModelSettingsFor(
      globalAgentSettings?.agentModelSettings,
      agentId,
      model.providerId,
      catalogModel?.id ?? model.effectiveModelId,
    )?.contextLimit,
    // What this run's model reads (text, image, …). One fact, two readers: the tool ledger's
    // `model` layer and the history's tool-image replay. Undefined for a model the catalog does
    // not know: the ledger then withholds nothing, and no image is replayed (a provider rejects
    // one the model cannot read).
    modelInput: catalogModel?.inputModalities as readonly string[] | undefined,
  }
}
