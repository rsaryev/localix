import { useUserSettings } from '@/features/settings/model/useUserSettings'
import { agentModelSettingsFor } from '@localixai/agent'
import { DEFAULT_MAX_TURNS } from '@localixai/api/turn-budget'
import { rememberAgentModelSettings } from './rememberModelReasoning'

export function useAgentModelTurns(
  agentId: string | null,
  providerId?: string,
  modelId?: string,
  agentLimit?: number,
) {
  const { settings, update } = useUserSettings()
  const entry =
    agentId && providerId && modelId
      ? agentModelSettingsFor(
          settings.agentSettings?.agentModelSettings,
          agentId,
          providerId,
          modelId,
        )
      : undefined
  const remember = (patch: { maxTurns?: number } | { contextPercent?: number }) => {
    if (!agentId || !providerId || !modelId) return
    rememberAgentModelSettings(
      {
        read: () => useUserSettings.getState().settings.agentSettings,
        write: (next) => update({ agentSettings: next }),
      },
      { agentId, providerId, modelId, ...patch },
    )
  }
  const inherited = Math.min(
    settings.agentSettings?.maxTurns ?? DEFAULT_MAX_TURNS,
    agentLimit ?? DEFAULT_MAX_TURNS,
  )
  return {
    value: entry?.maxTurns,
    inherited,
    limit: agentLimit,
    onChange: (maxTurns: number | undefined) => remember({ maxTurns }),
    context: {
      value: entry?.contextPercent,
      onChange: (contextPercent: number | undefined) => remember({ contextPercent }),
    },
  }
}
