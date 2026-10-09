import { useCallback, useMemo, useState } from 'react'
import { findCatalogModelForConnection, type CatalogModel } from '@localixai/agent/catalog'
import { isModelRoutingTaskEnabled } from '@localixai/api/model-task-catalog'
import type { ModelRoutingTaskKey } from '@localixai/api/client'
import {
  isAgentTarget,
  modelPickDestination,
  reasoningMemoryKey,
  targetAgentId,
  type PickerTarget,
} from './pickerTarget'
import { useUserSettings } from '@/features/settings/model/useUserSettings'
import type { ReasoningEffort } from '../../../model/reasoning'
import type { useConnections } from '../useConnections'
import {
  assignTaskModel,
  assignTaskReasoning,
  resolveLiveTaskModel,
  type ModelRoutingSlot,
} from './taskReasoning'
import {
  modelReasoningFor,
  normalizeModelReasoningPreferences,
  setModelReasoningInList,
} from '../../../model/modelReasoningPreferences'
import { getRecentModels, recordRecentModel } from './recentModels'
import { useRowReasoning } from './useRowReasoning'
import { clampModelReasoning } from '../../../model/modelReasoning'

type Connections = ReturnType<typeof useConnections>['connections']

interface UseModelTaskRoutingOptions {
  models: CatalogModel[]
  connections: Connections
  orderedConnections: Connections
  /** What the picker is choosing for: a global workload, or one participant of the chat. */
  taskKey: PickerTarget
  sessionModelId: string
  sessionConnectionId: string | null
  /** One named participant's route; absent (agent editor, onboarding) the session pair stands. */
  participantRoute?: (agentId: string) => ModelRoutingSlot
  reasoningEffort?: ReasoningEffort
  /** `agentId` names whose effort — without it the write landed on the party's first member. */
  onReasoningEffortChange?: (effort: ReasoningEffort, agentId?: string) => void
  /**
   * Assign the model. `agentId` names the participant it is for; the mount decides what that
   * means — the chat re-routes that agent, the agent editor stores it on the definition.
   */
  onPickSessionModel: (
    connectionId: string,
    modelId: string,
    reasoningEffort?: ReasoningEffort,
    agentId?: string,
  ) => void | Promise<void>
}

/**
 * Persistent model-routing policy shared by the picker rows and workload column.
 *
 * The browser component supplies live catalog/connection state and renders the result; this hook
 * owns settings reads/writes, stale-connection rebinding, per-model reasoning, and recent picks.
 */
export function useModelTaskRouting({
  models,
  connections,
  orderedConnections,
  taskKey,
  sessionModelId,
  sessionConnectionId,
  participantRoute,
  reasoningEffort,
  onReasoningEffortChange,
  onPickSessionModel,
}: UseModelTaskRoutingOptions) {
  const { settings, update } = useUserSettings()
  const [recent, setRecent] = useState(() => getRecentModels())
  const connectionById = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection])),
    [connections],
  )
  const agentSettings = settings.agentSettings
  // Read live, write through `update`: a render's closure over settings is already stale by the
  // time a second preference is written in the same interaction.
  const memoryIo = useMemo(
    () => ({
      read: () => useUserSettings.getState().settings.agentSettings,
      write: (next: Record<string, unknown>) => update({ agentSettings: next }),
    }),
    [update],
  )
  const routes = useMemo(() => agentSettings?.modelRouting ?? {}, [agentSettings])

  const setRouteSlot = useCallback(
    (key: Exclude<ModelRoutingTaskKey, 'session'>, slot: ModelRoutingSlot) => {
      const base = useUserSettings.getState().settings.agentSettings ?? {}
      const current = base.modelRouting?.[key] ?? {}
      const { reasoningEffort: _previousEffort, ...routeMetadata } = current
      const next = slot
        ? { ...routeMetadata, ...slot }
        : {
            ...(current.enabled === undefined ? {} : { enabled: current.enabled }),
            ...(current.reasoningPreferences?.length
              ? { reasoningPreferences: current.reasoningPreferences }
              : {}),
          }
      update({
        agentSettings: {
          ...base,
          modelRouting: { ...base.modelRouting, [key]: next },
        },
      })
    },
    [update],
  )

  const setRouteReasoningEffort = useCallback(
    (key: Exclude<ModelRoutingTaskKey, 'session'>, effort: ReasoningEffort | undefined) => {
      const base = useUserSettings.getState().settings.agentSettings ?? {}
      const current = base.modelRouting?.[key]
      if (!current?.providerConnectionId || !current.modelId) return
      const nextSlot = assignTaskReasoning(
        {
          providerConnectionId: current.providerConnectionId,
          modelId: current.modelId,
          ...(current.reasoningEffort ? { reasoningEffort: current.reasoningEffort } : {}),
        },
        effort,
      )
      if (!nextSlot) return
      const { reasoningEffort: _previousEffort, ...routeMetadata } = current
      update({
        agentSettings: {
          ...base,
          modelRouting: {
            ...base.modelRouting,
            [key]: { ...routeMetadata, ...nextSlot },
          },
        },
      })
    },
    [update],
  )

  const routeSlotFor = useCallback(
    (key: Exclude<ModelRoutingTaskKey, 'session'>): ModelRoutingSlot => {
      const route = routes[key]
      if (!route?.providerConnectionId || !route.modelId) return null
      return {
        providerConnectionId: route.providerConnectionId,
        modelId: route.modelId,
        ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}),
      }
    },
    [routes],
  )

  const slotForTask = useCallback(
    (key: PickerTarget): ModelRoutingSlot => {
      // Each participant answers for itself; a mount with no party falls back to the one pair.
      const agentId = targetAgentId(key)
      const fallback: ModelRoutingSlot =
        sessionConnectionId && sessionModelId
          ? { providerConnectionId: sessionConnectionId, modelId: sessionModelId }
          : null
      if (agentId !== null) return participantRoute?.(agentId) ?? fallback
      if (key === 'session') return fallback
      return routeSlotFor(key as Exclude<ModelRoutingTaskKey, 'session'>)
    },
    [participantRoute, routeSlotFor, sessionConnectionId, sessionModelId],
  )

  const enabledForTask = useCallback(
    // A participant is never "off": you cannot disable someone who is in the room.
    (key: PickerTarget) =>
      isAgentTarget(key) || isModelRoutingTaskEnabled(agentSettings, key as ModelRoutingTaskKey),
    [agentSettings],
  )

  const liveSlotFor = useCallback(
    (slot: ModelRoutingSlot) => resolveLiveTaskModel(models, orderedConnections, slot),
    [models, orderedConnections],
  )

  const setTaskEnabled = useCallback(
    (key: ModelRoutingTaskKey, enabled: boolean) => {
      const base = useUserSettings.getState().settings.agentSettings ?? {}
      update({
        agentSettings: {
          ...base,
          modelRouting: {
            ...base.modelRouting,
            [key]: { ...base.modelRouting?.[key], enabled },
          },
        },
      })
    },
    [update],
  )

  const modelLabelFor = useCallback(
    (key: PickerTarget) => {
      const slot = slotForTask(key)
      if (!slot) return null
      return liveSlotFor(slot)?.model.name ?? slot.modelId
    },
    [liveSlotFor, slotForTask],
  )

  const currentSlot = slotForTask(taskKey)
  const currentLiveSlot = liveSlotFor(currentSlot)
  // Everything the rows SAY and WRITE about reasoning — one hook, so a row's level, what it
  // inherits and where a change lands cannot be three different opinions.
  const {
    preferences: reasoningPreferences,
    carried: carriedEffort,
    resolveRowReasoning,
    inheritedRowReasoning,
    changeModelReasoning,
  } = useRowReasoning({
    taskKey,
    currentSlot,
    reasoningEffort,
    hasParty: Boolean(participantRoute),
    storedPreferences: targetAgentId(taskKey)
      ? (agentSettings?.agentModelSettings ?? [])
          .filter((entry) => entry.agentId === targetAgentId(taskKey) && entry.effort !== undefined)
          .map((entry) => ({
            providerId: entry.providerId,
            modelId: entry.modelId,
            effort: entry.effort,
          }))
      : routes[reasoningMemoryKey(taskKey)]?.reasoningPreferences,
    memoryIo,
    onReasoningEffortChange,
    setRouteReasoningEffort,
  })

  const pickModel = useCallback(
    async (connectionId: string, modelId: string) => {
      const connection = connectionById.get(connectionId)
      const nextModel = findCatalogModelForConnection(models, connections, connectionId, modelId)
      if (!connection || !nextModel) return
      const savedEffort = modelReasoningFor(reasoningPreferences, connection.providerId, modelId)
      const destination = modelPickDestination(taskKey)
      if (destination.kind === 'conversation') {
        // `off` for a model that cannot reason is honest about THAT model. What it is not is a
        // level to carry: `carriedEffort` is what a model with no memory of its own inherits,
        // and it deliberately looks past an `off` the previous model put there.
        // Re-selecting the current model must preserve this seat's level, even if another
        // conversation has since changed the shared per-model preference.
        const isCurrent =
          currentLiveSlot?.connection.id === connectionId &&
          currentLiveSlot.model.id === nextModel.id
        const currentEffort = currentSlot?.reasoningEffort ?? reasoningEffort
        const nextEffort = nextModel.supportsReasoning
          ? clampModelReasoning(
              (isCurrent ? currentEffort : savedEffort) ?? carriedEffort,
              nextModel.reasoningEfforts,
            )
          : 'off'
        // Nothing is remembered here. The carried level is what this model RUNS at now, not a
        // level anyone chose for it — writing it into the model's memory turned an inheritance
        // into a permanent choice on first use, so the model kept whatever the session happened
        // to be on and stopped following it afterwards. The memory is written where a level is
        // actually chosen: `changeModelReasoning`.
        // `session` is the direct-pick target used by onboarding and the agent editor. It has no
        // participant id, while an open conversation names the exact participant being routed.
        // Treating `session` like a workload made `workloadKey('session')` return null below and
        // silently discarded the pick in both direct-pick surfaces.
        await onPickSessionModel(connectionId, modelId, nextEffort, destination.agentId)
      } else {
        const workload = destination.key
        const existing = slotForTask(taskKey)
        const nextEffort = nextModel.supportsReasoning
          ? clampModelReasoning(savedEffort, nextModel.reasoningEfforts)
          : 'off'
        if (nextEffort) {
          const base = useUserSettings.getState().settings.agentSettings ?? {}
          const route = base.modelRouting?.[workload] ?? {}
          update({
            agentSettings: {
              ...base,
              modelRouting: {
                ...base.modelRouting,
                [taskKey]: {
                  ...route,
                  reasoningPreferences: setModelReasoningInList(
                    normalizeModelReasoningPreferences(route.reasoningPreferences),
                    {
                      providerId: connection.providerId,
                      modelId,
                      effort: nextEffort,
                    },
                  ),
                },
              },
            },
          })
        }
        setRouteSlot(workload, assignTaskModel(existing, connectionId, modelId, nextEffort))
      }
      recordRecentModel({ connectionId, modelId })
      setRecent(getRecentModels())
    },
    [
      carriedEffort,
      connectionById,
      connections,
      currentLiveSlot,
      currentSlot,
      models,
      onPickSessionModel,
      reasoningPreferences,
      reasoningEffort,
      setRouteSlot,
      slotForTask,
      taskKey,
      update,
    ],
  )

  return {
    routes,
    recent,
    setRouteSlot,
    slotForTask,
    enabledForTask,
    liveSlotFor,
    setTaskEnabled,
    modelLabelFor,
    currentSlot,
    currentLiveSlot,
    resolveRowReasoning,
    inheritedRowReasoning,
    changeModelReasoning,
    pickModel,
  }
}
