/**
 * Auxiliary-model resolution shared by every inline-AI surface. Each surface
 * owns one model-drawer route and falls back to the session model when its route
 * has no explicit assignment.
 *
 * Resolution is AGNOSTIC to the stored connection id: a slot names a
 * (provider, model), and `buildLanguageModel` builds it through ANY live
 * connection of that provider. So deleting and re-adding a provider (which mints
 * a new connection id) keeps the slot working, and a slot whose exact connection
 * is gone still resolves instead of silently disabling the feature. The stored
 * id is passed only as a "try first" hint.
 */

import type { createAuxProviderHelpers } from '../chat/service/aux-provider'
import type { ReasoningEffort } from '../../db/types'
import type { AgentSettings } from '../user/contracts'
import { isModelRoutingTaskEnabled, type AuxTaskKey } from '../../contracts/model-task-catalog'

type AuxHelpers = ReturnType<typeof createAuxProviderHelpers>

export interface AuxModelDeps {
  readAgentSettings: AuxHelpers['readAgentSettings']
  /** Session's provider/model — the fallback for an unassigned workload route. */
  getSessionModel: (
    userId: string,
    sessionId: string,
  ) => Promise<{
    providerConnectionId: string | null
    modelId: string | null
    reasoningEffort?: ReasoningEffort | null
  } | null>
}

type AuxLanguageModel = NonNullable<Awaited<ReturnType<AuxHelpers['buildLanguageModel']>>>['model']

export interface AuxLanguageModelDeps extends AuxModelDeps {
  /** Agnostic build: a model + optional preferred-connection hint → a provider. */
  buildLanguageModel: AuxHelpers['buildLanguageModel']
}

export interface ResolvedAuxLanguageModel {
  model: AuxLanguageModel
  providerConnectionId: string
  providerId: string
  modelId: string
  reasoningEffort: 'off'
}

export type InlineAssistTaskKey = Extract<AuxTaskKey, 'inlineCompletion'>

/**
 * Resolve a WORKING provider for one inline-assist route. The route's explicit
 * model is tried first (through any live connection of its provider), then the
 * session model. An off route never falls through to another route or model.
 * Inline completion always requests reasoning off; the runtime chooses the lowest
 * supported level when the resolved model cannot disable reasoning.
 */
export async function resolveAuxLanguageModel(
  deps: AuxLanguageModelDeps,
  userId: string,
  sessionId: string,
  taskKey: InlineAssistTaskKey = 'inlineCompletion',
  preloaded: { agentSettings?: AgentSettings | null } = {},
): Promise<ResolvedAuxLanguageModel | null> {
  const candidates: {
    modelId: string
    preferredConnectionId?: string | null
  }[] = []
  // Rich-context callers may need the route gate before doing filesystem or
  // database work. Accept their already-read snapshot so the enabled path does
  // not pay for a second profile query and route semantics stay one-snapshot.
  const agentSettings = Object.prototype.hasOwnProperty.call(preloaded, 'agentSettings')
    ? (preloaded.agentSettings ?? null)
    : await deps.readAgentSettings(userId)
  if (!isModelRoutingTaskEnabled(agentSettings, taskKey)) return null
  const slot = agentSettings?.modelRouting?.[taskKey]
  const session = await deps.getSessionModel(userId, sessionId).catch(() => null)
  if (slot?.modelId)
    candidates.push({
      modelId: slot.modelId,
      preferredConnectionId: slot.providerConnectionId,
    })
  if (
    session?.modelId &&
    !candidates.some(
      (candidate) =>
        candidate.modelId === session.modelId &&
        (candidate.preferredConnectionId ?? null) === session.providerConnectionId,
    )
  ) {
    candidates.push({
      modelId: session.modelId,
      preferredConnectionId: session.providerConnectionId,
    })
  }
  for (const c of candidates) {
    const built = await deps
      .buildLanguageModel(userId, c.modelId, c.preferredConnectionId)
      .catch(() => null)
    if (built)
      return {
        model: built.model,
        providerConnectionId: built.providerConnectionId,
        providerId: built.providerId,
        modelId: c.modelId,
        // Session/slot effort can be high or max, making keystroke assistance wait
        // for unnecessary thinking. Off clamps to the model's minimum in the adapter.
        reasoningEffort: 'off',
      }
  }
  return null
}
