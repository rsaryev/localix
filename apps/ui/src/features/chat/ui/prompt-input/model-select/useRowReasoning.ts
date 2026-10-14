import { useCallback, useMemo } from 'react'
import type { ModelRoutingTaskKey } from '@localixai/api/client'
import { carriedReasoningEffort } from '../../../model/modelReasoning'
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
import { rowReasoning } from './rowReasoning'
import type { ModelRoutingSlot } from './taskReasoning'

interface UseRowReasoningArgs {
  taskKey: PickerTarget
  /** The route the picker is pointed at: a participant's seat, or a workload's slot. */
  currentSlot: ModelRoutingSlot
  /** The conversation's level — the stand-in for mounts that have no party to ask. */
  reasoningEffort: ReasoningEffort | undefined
  /** Present when a party answers for its members; absent in the agent editor and onboarding. */
  hasParty: boolean
  /** The per provider/model memory of this target's bucket, as stored in user settings. */
  storedPreferences: unknown
  memoryIo: ModelReasoningMemoryIo
  onReasoningEffortChange?: (effort: ReasoningEffort, agentId?: string) => void
  /** Write a workload's own override; a participant's goes through `onReasoningEffortChange`. */
  setRouteReasoningEffort: (
    key: Exclude<ModelRoutingTaskKey, 'session'>,
    effort: ReasoningEffort | undefined,
  ) => void
}

/**
 * EVERYTHING THE PICKER SAYS AND WRITES ABOUT REASONING, in one place.
 *
 * It was three decisions spread through the routing hook, and they disagreed in both directions:
 * a row with no level of its own displayed the conversation's as though it had been chosen for
 * that model, so raising one row's level repainted the whole list; and the target's own level was
 * read from the session rather than from the member's seat, so opening another participant showed
 * the level just set for the previous one.
 *
 * Reading them from one hook is what keeps them one answer. `rowReasoning` holds the rule itself
 * and is pure, so the rule can be read without React at all.
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

  /**
   * The level the picker's CURRENT target holds — this participant's seat, or this workload's
   * slot. Not the conversation's: a party has one level per member.
   *
   * The flat prop stands in only where there is no party to ask, which is exactly the case in
   * which it IS the target's level.
   */
  const targetEffort =
    (currentSlot?.reasoningEffort as ReasoningEffort | undefined) ??
    (isAgentTarget(taskKey) && hasParty ? undefined : reasoningEffort)

  /** What a model with no memory of its own inherits — see `carriedReasoningEffort`. */
  const carried = carriedReasoningEffort(targetEffort, null)

  const rowFor = useCallback(
    (providerId: string, modelId: string, selected: boolean) =>
      rowReasoning({
        selected,
        chosen: targetEffort,
        saved: modelReasoningFor(preferences, providerId, modelId),
        carried,
        // Only a workload row can fall back to the session's level; a chat row IS the session.
        sessionFallback: !isAgentTarget(taskKey) && currentSlot ? reasoningEffort : undefined,
      }),
    [carried, currentSlot, preferences, reasoningEffort, targetEffort, taskKey],
  )

  const resolveRowReasoning = useCallback(
    (providerId: string, modelId: string, selected: boolean): ReasoningEffort | undefined =>
      rowFor(providerId, modelId, selected).value,
    [rowFor],
  )

  const inheritedRowReasoning = useCallback(
    (providerId: string, modelId: string, selected: boolean): ReasoningEffort | undefined =>
      rowFor(providerId, modelId, selected).inherited,
    [rowFor],
  )

  const changeModelReasoning = useCallback(
    (
      providerId: string,
      modelId: string,
      effort: ReasoningEffort | undefined,
      selected: boolean,
    ) => {
      // Following the session must clear a preview model's saved choice too; otherwise
      // the menu accepts the click but immediately renders the same old explicit level.
      const agentId = targetAgentId(taskKey)
      if (agentId) {
        rememberAgentModelSettings(memoryIo, { agentId, providerId, modelId, effort })
      } else if (effort !== undefined || !selected) {
        rememberModelReasoning(memoryIo, reasoningMemoryKey(taskKey), {
          providerId,
          modelId,
          effort,
        })
      }
      if (!selected) return
      // Named, so the write reaches the selected participant, not whoever sits first.
      const effortAgentId = targetAgentId(taskKey)
      if (effortAgentId !== null) {
        if (effort) onReasoningEffortChange?.(effort, effortAgentId)
        return
      }
      if (taskKey === 'session') {
        onReasoningEffortChange?.(effort ?? carried)
        return
      }
      if (currentSlot) {
        setRouteReasoningEffort(taskKey as Exclude<ModelRoutingTaskKey, 'session'>, effort)
      }
    },
    [carried, currentSlot, memoryIo, onReasoningEffortChange, setRouteReasoningEffort, taskKey],
  )

  return {
    /** The saved per provider/model levels of this target's bucket. */
    preferences,
    /** What a model with no level of its own would run at here. */
    carried,
    resolveRowReasoning,
    inheritedRowReasoning,
    changeModelReasoning,
  }
}
