import { useUserSettings } from '@/shared/lib/user-settings/useUserSettings'
import { agentModelSettingsFor, type ContextLimit } from '@localixai/agent'
import { inheritedMaxTurns } from './modelSettingChoices'
import { rememberAgentModelSettings, type ModelReasoningMemoryIo } from './rememberModelReasoning'

/** The per-agent model settings in user settings, read and written as they are right now. */
export const agentSettingsIo: ModelReasoningMemoryIo = {
  read: () => useUserSettings.getState().settings.agentSettings,
  write: (next) => useUserSettings.getState().update({ agentSettings: next }),
}

export function useAgentModelTurns(
  agentId: string | null,
  providerId?: string,
  modelId?: string,
  agentLimit?: number,
) {
  const { settings } = useUserSettings()
  const entry =
    agentId && providerId && modelId
      ? agentModelSettingsFor(
          settings.agentSettings?.agentModelSettings,
          agentId,
          providerId,
          modelId,
        )
      : undefined
  const remember = (patch: { maxTurns?: number } | { contextLimit?: ContextLimit }) => {
    if (!agentId || !providerId || !modelId) return
    rememberAgentModelSettings(agentSettingsIo, { agentId, providerId, modelId, ...patch })
  }
  const inherited = inheritedMaxTurns(settings.agentSettings?.maxTurns, agentLimit)
  return {
    value: entry?.maxTurns,
    inherited,
    limit: agentLimit,
    onChange: (maxTurns: number | undefined) => remember({ maxTurns }),
    context: {
      value: entry?.contextLimit,
      onChange: (contextLimit: ContextLimit | undefined) => remember({ contextLimit }),
    },
  }
}
