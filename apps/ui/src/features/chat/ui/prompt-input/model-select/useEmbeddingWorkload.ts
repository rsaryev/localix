import { useCallback, useMemo } from 'react'
import { MODEL_ROUTING_TASKS } from '@localixai/api/model-task-catalog'
import type { CatalogModel, ModelKind } from '@localixai/agent/catalog'
import { semanticApi, type SemanticStatus } from '@/shared/api/semanticApi'
import { useSemanticStatus } from '@/shared/hooks/useLocalModels'
import { useModelsCatalog } from '@/shared/hooks/useModelsCatalog'
import type { PickerTarget } from './pickerTarget'
import type { ModelRoutingSlot } from './taskReasoning'
import type { useModelTaskRouting } from './useModelTaskRouting'

type Routing = ReturnType<typeof useModelTaskRouting>

/** The kind of model a picker target runs on: chat, unless its workload says otherwise. */
export function modelKindForTarget(target: PickerTarget): ModelKind {
  return MODEL_ROUTING_TASKS.find((task) => task.key === target)?.modelKind ?? 'chat'
}

/**
 * The models a workload lists — the kind it runs on: chat, or embedding for semantic search —
 * and every kind together, so a row's label resolves whichever workload is open.
 */
export function useWorkloadModels(chatModels: CatalogModel[], target: PickerTarget) {
  const { modelsOfKind } = useModelsCatalog()
  const taskKind = modelKindForTarget(target)
  const models = taskKind === 'chat' ? chatModels : modelsOfKind(taskKind)
  const allModels = useMemo(
    () => [...chatModels, ...modelsOfKind('embedding')],
    [chatModels, modelsOfKind],
  )
  return { taskKind, models, allModels }
}

/** The catalog id of semantic search's model: `local/<id>` on this computer. */
export const semanticCatalogId = (model: SemanticStatus['model']) =>
  model.providerId === 'local' ? `local/${model.id}` : model.id

/**
 * Workloads that run on an embedding model (semantic search), routed like every other workload
 * in the picker — a row with a switch and a model — but owned by their own service: its state
 * is read from and written to `/rpc/semantic`, not to `agentSettings.modelRouting`. Wraps the
 * chat routing and answers for those targets; every other target passes through unchanged.
 */
export function useEmbeddingWorkload(
  routing: Routing,
  taskKey: PickerTarget,
  connections: ReadonlyArray<{ id: string; providerId: string }>,
): Routing {
  const { status, refresh } = useSemanticStatus()
  const isEmbedding = useCallback(
    (key: PickerTarget) => modelKindForTarget(key) === 'embedding',
    [],
  )
  const slot: ModelRoutingSlot = useMemo(() => {
    if (!status) return null
    const connection = connections.find((c) => c.providerId === status.model.providerId)
    return connection
      ? { providerConnectionId: connection.id, modelId: semanticCatalogId(status.model) }
      : null
  }, [connections, status])

  const apply = useCallback(
    async (action: () => Promise<SemanticStatus>) => {
      await refresh(await action(), { revalidate: false })
    },
    [refresh],
  )

  return useMemo(() => {
    const enabledForTask = (key: PickerTarget) =>
      isEmbedding(key) ? !!status?.enabled : routing.enabledForTask(key)
    const setTaskEnabled: Routing['setTaskEnabled'] = (key, enabled) => {
      if (!isEmbedding(key)) return routing.setTaskEnabled(key, enabled)
      void apply(() => (enabled ? semanticApi.enable() : semanticApi.disable()))
    }
    const modelLabelFor = (key: PickerTarget) =>
      isEmbedding(key) ? (status?.model.label ?? null) : routing.modelLabelFor(key)
    const slotForTask = (key: PickerTarget) => (isEmbedding(key) ? slot : routing.slotForTask(key))
    const base = { ...routing, enabledForTask, setTaskEnabled, modelLabelFor, slotForTask }
    if (!isEmbedding(taskKey)) return base
    const live = routing.liveSlotFor(slot)
    return {
      ...base,
      currentSlot: slot,
      currentLiveSlot: live,
      isCurrentModel: (model) =>
        live?.model.id === model.id && live.model.providerId === model.providerId,
      pickModel: async (_connectionId, modelId) => apply(() => semanticApi.setModel(modelId)),
    }
  }, [apply, isEmbedding, routing, slot, status, taskKey])
}
