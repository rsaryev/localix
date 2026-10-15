import { useCallback, useMemo } from 'react'
import type { CatalogModel } from '@localixai/agent/catalog'
import type { ModelRoutingTaskKey } from '@localixai/api/client'
import { clampModelReasoning, initialModelReasoning } from '../../../model/modelReasoning'
import type { ReasoningEffort } from '../../../model/reasoning'
import {
  modelReasoningFor,
  normalizeModelReasoningPreferences,
} from '../../../model/modelReasoningPreferences'
import { isAgentTarget, reasoningMemoryKey, targetAgentId, type PickerTarget } from './pickerTarget'
import {
  rememberModelReasoning,
  rememberAgentModelSettings,
  type ModelReasoningMemoryIo,
} from './rememberModelReasoning'
import type { ModelRoutingSlot } from './taskReasoning'

type ReasoningModel = Pick<
  CatalogModel,
  'id' | 'providerId' | 'supportsReasoning' | 'reasoningEfforts'
>

interface UseRowReasoningArgs {
  taskKey: PickerTarget
  /** The route the picker is pointed at: a participant's seat, or a workload's slot. */
  currentSlot: ModelRoutingSlot
  /** The conversation's level — the target's own level only where there is no party to ask. */
  reasoningEffort: ReasoningEffort | undefined
  /** Present when a party answers for its members; absent in the agent editor and onboarding. */
  hasParty: boolean
  /** The per provider/model memory of this target, as stored in user settings. */
  storedPreferences: unknown
  memoryIo: ModelReasoningMemoryIo
  onReasoningEffortChange?: (effort: ReasoningEffort, agentId?: string) => void
  /** Write a workload's own level; a participant's goes through `onReasoningEffortChange`. */
  setRouteReasoningEffort: (
    key: Exclude<ModelRoutingTaskKey, 'session'>,
    effort: ReasoningEffort,
  ) => void
}

/**
 * EVERYTHING THE PICKER SAYS AND WRITES ABOUT REASONING, in one place.
 *
 * Two rules, no inheritance:
 *   - The model the target runs on shows the target's own level (the seat or the workload slot).
 *   - Any other model shows the level it would START at if picked: the level last chosen for it
 *     by this target, else the model's default (`initialModelReasoning`).
 *
 * A change always records the level for that model, and on the running model also writes the
 * live route — so what the panel shows for a model never depends on which row was hovered last.
 */
export function useRowReasoning({
  taskKey,
  currentSlot,
  reasoningEffort,
  hasParty,
  storedPreferences,
  memoryIo,
  onReasoningEffortChange,
  setRouteReasoningEffort,
}: UseRowReasoningArgs) {
  const preferences = useMemo(
    () => normalizeModelReasoningPreferences(storedPreferences),
    [storedPreferences],
  )

  /** The level the target holds right now; the flat prop only where no party can answer. */
  const targetEffort =
    (currentSlot?.reasoningEffort as ReasoningEffort | undefined) ??
    (isAgentTarget(taskKey) && hasParty ? undefined : reasoningEffort)

  const reasoningFor = useCallback(
    (model: ReasoningModel, current: boolean): ReasoningEffort => {
      const saved = modelReasoningFor(preferences, model.providerId, model.id)
      if (current && model.supportsReasoning && targetEffort !== undefined) {
        return clampModelReasoning(targetEffort, model.reasoningEfforts) ?? targetEffort
      }
      return initialModelReasoning(model, saved)
    },
    [preferences, targetEffort],
  )

  const changeModelReasoning = useCallback(
    (model: ReasoningModel, effort: ReasoningEffort, current: boolean) => {
      const agentId = targetAgentId(taskKey)
      const entry = { providerId: model.providerId, modelId: model.id, effort }
      if (agentId) rememberAgentModelSettings(memoryIo, { agentId, ...entry })
      else rememberModelReasoning(memoryIo, reasoningMemoryKey(taskKey), entry)
      if (!current) return
      if (agentId) onReasoningEffortChange?.(effort, agentId)
      else if (taskKey === 'session') onReasoningEffortChange?.(effort)
      else setRouteReasoningEffort(taskKey as Exclude<ModelRoutingTaskKey, 'session'>, effort)
    },
    [memoryIo, onReasoningEffortChange, setRouteReasoningEffort, taskKey],
  )

  return { reasoningFor, changeModelReasoning }
}
