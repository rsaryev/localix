import type { ReasoningEffort } from '../../db/types'

/**
 * WHICH MODEL AND EFFORT A SUBAGENT RUNS ON.
 *
 * One rule, the person's: the model and effort the person chose for that agent in Localix's
 * settings (`agentSettings.agentModelChoices`); when they chose none, the session's own. Nothing
 * else decides it. The agent's file has no say (its `model` and `effort` are not read), the
 * `Agent` call and a workflow's `agent()` have none either, and no recent pick, project default
 * or alias is consulted.
 */

/** An agent's own route: the parts the person chose, the rest left to the session. */
export interface AgentRoute {
  providerConnectionId?: string | null
  modelId?: string
  reasoningEffort?: ReasoningEffort
}

/** One agent's choice, as stored in the person's settings. */
export interface AgentModelChoice {
  agentId: string
  providerConnectionId?: string | null
  modelId?: string
  effort?: ReasoningEffort
}

/**
 * The route the person chose for `agentId`; empty when they chose none, which leaves the child on
 * its session's. A chosen model without a connection finds a live one when the run starts.
 */
export function agentChoiceRoute(
  choices: readonly AgentModelChoice[] | undefined,
  agentId: string,
): AgentRoute {
  const choice = choices?.find((entry) => entry.agentId === agentId)
  if (!choice) return {}
  return {
    ...(choice.modelId
      ? { modelId: choice.modelId, providerConnectionId: choice.providerConnectionId ?? null }
      : {}),
    ...(choice.effort ? { reasoningEffort: choice.effort } : {}),
  }
}
