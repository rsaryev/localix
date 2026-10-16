import type { ContextLimit } from './context-limit'
import type { ReasoningEffort } from './types'

/** Model parameters belong to an exact agent/provider/model triple, never to a whole party. */
export interface AgentModelSettings {
  agentId: string
  providerId: string
  modelId: string
  effort?: ReasoningEffort
  maxTurns?: number
  /** Request ceiling the run budgets against (`context-limit.ts`); absent means Auto. */
  contextLimit?: ContextLimit
}

export function agentModelSettingsFor(
  settings: readonly AgentModelSettings[] | undefined,
  agentId: string,
  providerId: string,
  modelId: string,
): AgentModelSettings | undefined {
  return settings?.find(
    (entry) =>
      entry.agentId === agentId && entry.providerId === providerId && entry.modelId === modelId,
  )
}

/** Patch one triple, keeping its other parameters and every other agent/model intact. */
export function setAgentModelSettings(
  settings: readonly AgentModelSettings[] | undefined,
  patch: AgentModelSettings,
): AgentModelSettings[] {
  const previous = agentModelSettingsFor(settings, patch.agentId, patch.providerId, patch.modelId)
  const next = { ...previous, ...patch }
  if ('effort' in patch && patch.effort === undefined) delete next.effort
  if ('maxTurns' in patch && patch.maxTurns === undefined) delete next.maxTurns
  if ('contextLimit' in patch && patch.contextLimit === undefined) delete next.contextLimit
  const rest = (settings ?? []).filter((entry) => entry !== previous)
  const kept =
    next.effort !== undefined || next.maxTurns !== undefined || next.contextLimit !== undefined
  return (kept ? [next, ...rest] : rest).slice(0, 200)
}
