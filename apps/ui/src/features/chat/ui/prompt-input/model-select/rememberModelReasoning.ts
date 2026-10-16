/** Named agents remember parameters per provider/model; unnamed workloads keep their own bucket. */
import { setAgentModelSettings, type AgentModelSettings } from '@localixai/agent'
import type { ModelRoutingTaskKey } from '@localixai/api/client'
import type { ReasoningEffort } from '../../../model/reasoning'
import {
  normalizeModelReasoningPreferences,
  setModelReasoningInList,
} from '../../../model/modelReasoningPreferences'

export interface ModelReasoningMemoryIo {
  /** Settings as they are RIGHT NOW, not as the render closed over them. */
  read: () =>
    | {
        modelRouting?: Record<string, { reasoningPreferences?: unknown; [key: string]: unknown }>
        agentModelSettings?: AgentModelSettings[]
      }
    | undefined
  write: (settings: Record<string, unknown>) => void
}

export function rememberModelReasoning(
  io: ModelReasoningMemoryIo,
  bucket: ModelRoutingTaskKey,
  entry: { providerId: string; modelId: string; effort: ReasoningEffort },
): void {
  const base = io.read() ?? {}
  const route = base.modelRouting?.[bucket] ?? {}
  io.write({
    ...base,
    modelRouting: {
      ...base.modelRouting,
      [bucket]: {
        ...route,
        reasoningPreferences: setModelReasoningInList(
          normalizeModelReasoningPreferences(route.reasoningPreferences),
          entry,
        ),
      },
    },
  })
}

export function rememberAgentModelSettings(
  io: ModelReasoningMemoryIo,
  patch: AgentModelSettings,
): void {
  const base = io.read() ?? {}
  io.write({ ...base, agentModelSettings: setAgentModelSettings(base.agentModelSettings, patch) })
}
