import type { ReasoningEffort } from './types'

/** Model parameters belong to an exact agent/provider/model triple, never to a whole party. */
export interface AgentModelSettings {
  agentId: string
  providerId: string
  modelId: string
  effort?: ReasoningEffort
  maxTurns?: number
  /** Share of the model's context window the run budgets against, in percent. */
  contextPercent?: number
}

/** Default and bounds for `contextPercent`: the share of the real window a run budgets against. */
export const DEFAULT_CONTEXT_PERCENT = 70
export const MIN_CONTEXT_PERCENT = 20
export const MAX_CONTEXT_PERCENT = 100
export const CONTEXT_PERCENT_STEPS = [30, 50, 70, 80, 90, 100] as const

export function clampContextPercent(percent?: number): number {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return DEFAULT_CONTEXT_PERCENT
  return Math.min(MAX_CONTEXT_PERCENT, Math.max(MIN_CONTEXT_PERCENT, Math.round(percent)))
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
  if ('contextPercent' in patch && patch.contextPercent === undefined) delete next.contextPercent
  const rest = (settings ?? []).filter((entry) => entry !== previous)
  const kept =
    next.effort !== undefined || next.maxTurns !== undefined || next.contextPercent !== undefined
  return (kept ? [next, ...rest] : rest).slice(0, 200)
}
