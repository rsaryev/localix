/**
 * Remember an effort for one MODEL, so picking that model again starts where you left it.
 *
 * The memory is about a model, not about who runs it — "I like this one on high" holds whoever
 * asks — which is why every participant shares the `session` bucket (see `reasoningMemoryKey`).
 *
 * It lives here because both writers in the picker performed the same read-merge-write against
 * user settings, once when a model is chosen and once when its effort is changed, and a second
 * copy of a read-modify-write is where the two drift.
 */
import type { ModelRoutingTaskKey } from '@localixai/api/client'
import type { ReasoningEffort } from '../../../model/reasoning'
import {
  normalizeModelReasoningPreferences,
  setModelReasoningInList,
  removeModelReasoningFromList,
} from '../../../model/modelReasoningPreferences'

export interface ModelReasoningMemoryIo {
  /** Settings as they are RIGHT NOW, not as the render closed over them. */
  read: () =>
    | {
        modelRouting?: Record<string, { reasoningPreferences?: unknown; [key: string]: unknown }>
      }
    | undefined
  write: (settings: Record<string, unknown>) => void
}

export function rememberModelReasoning(
  io: ModelReasoningMemoryIo,
  bucket: ModelRoutingTaskKey,
  entry: { providerId: string; modelId: string; effort: ReasoningEffort | undefined },
): void {
  const base = io.read() ?? {}
  const route = base.modelRouting?.[bucket] ?? {}
  io.write({
    ...base,
    modelRouting: {
      ...base.modelRouting,
      [bucket]: {
        ...route,
        reasoningPreferences:
          entry.effort === undefined
            ? removeModelReasoningFromList(
                normalizeModelReasoningPreferences(route.reasoningPreferences),
                entry.providerId,
                entry.modelId,
              )
            : setModelReasoningInList(
                normalizeModelReasoningPreferences(route.reasoningPreferences),
                { ...entry, effort: entry.effort },
              ),
      },
    },
  })
}
