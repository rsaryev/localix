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
import { useUserSettings } from '@/shared/lib/user-settings/useUserSettings'
import type { ReasoningEffort } from '../../../model/reasoning'
import type { useConnections } from '../useConnections'
import {
  assignTaskModel,
  liveRouteModel,
  resolveLiveTaskModel,
  type ModelRoutingSlot,
} from './taskReasoning'
import { getRecentModels, recordRecentModel } from './recentModels'
import { useRowReasoning } from './useRowReasoning'

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
  /** The room's shared route for the "All agents" target; null while members differ. */
  partyRoute?: () => ModelRoutingSlot
  /** Put every participant on one model at one level (already clamped to that model). */
  onPickPartyModel?: (
    connectionId: string,
    modelId: string,
    reasoningEffort: ReasoningEffort,
  ) => void | Promise<void>
  /** Every participant's level, when they already share a model. */
  onPartyReasoningChange?: (effort: ReasoningEffort) => void
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
  partyRoute,
  onPickPartyModel,
  onPartyReasoningChange,
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
    (key: Exclude<ModelRoutingTaskKey, 'session'>, effort: ReasoningEffort) => {
      const base = useUserSettings.getState().settings.agentSettings ?? {}
      const current = base.modelRouting?.[key]
      if (!current?.providerConnectionId || !current.modelId) return
      update({
        agentSettings: {
          ...base,
          modelRouting: { ...base.modelRouting, [key]: { ...current, reasoningEffort: effort } },
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
      if (key === 'party') return partyRoute?.() ?? null
      if (key === 'session') return fallback
      return routeSlotFor(key as Exclude<ModelRoutingTaskKey, 'session'>)
    },
    [participantRoute, partyRoute, routeSlotFor, sessionConnectionId, sessionModelId],
  )

  const enabledForTask = useCallback(
    // A participant is never "off": you cannot disable someone who is in the room.
    (key: PickerTarget) =>
      isAgentTarget(key) ||
      key === 'party' ||
      isModelRoutingTaskEnabled(agentSettings, key as ModelRoutingTaskKey),
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
  // Everything the rows SAY and WRITE about reasoning — one hook, so what a model shows and
  // where a change lands cannot be two different opinions.
  const { reasoningFor, changeModelReasoning } = useRowReasoning({
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
    onPartyReasoningChange,
    setRouteReasoningEffort,
  })

  /** Whether a model is the one this target runs on — by provider and model, not connection. */
  const isCurrentModel = useCallback(
    (model: Pick<CatalogModel, 'id' | 'providerId'>) =>
      currentLiveSlot?.model.id === model.id &&
      currentLiveSlot.model.providerId === model.providerId,
    [currentLiveSlot],
  )

  const pickModel = useCallback(
    async (pickedConnectionId: string, modelId: string) => {
      // The model's own provider decides the connection: a pick never pairs a model with a
      // connection of another provider (a `local/…` model routed through OpenRouter).
      const live = liveRouteModel(models, connections, modelId, pickedConnectionId)
      const connectionId = live?.connection.id ?? pickedConnectionId
      const nextModel =
        live?.model ?? findCatalogModelForConnection(models, connections, connectionId, modelId)
      if (!connectionById.has(connectionId) || !nextModel) return
      // Re-picking the running model keeps its level; any other model starts at the level last
      // chosen for it, else its default. The previous model's level never carries over.
      const nextEffort = reasoningFor(nextModel, isCurrentModel(nextModel))
      const destination = modelPickDestination(taskKey)
      if (destination.kind === 'conversation') {
        await onPickSessionModel(connectionId, modelId, nextEffort, destination.agentId)
      } else if (destination.kind === 'party') {
        await onPickPartyModel?.(connectionId, modelId, nextEffort)
      } else {
        setRouteSlot(
          destination.key,
          assignTaskModel(slotForTask(taskKey), connectionId, modelId, nextEffort),
        )
      }
      recordRecentModel({ connectionId, modelId })
      setRecent(getRecentModels())
    },
    [
      connectionById,
      connections,
      isCurrentModel,
      models,
      onPickPartyModel,
      onPickSessionModel,
      reasoningFor,
      setRouteSlot,
      slotForTask,
      taskKey,
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
    isCurrentModel,
    reasoningFor,
    changeModelReasoning,
    pickModel,
  }
}
