import { useCallback, useMemo } from 'react'
import { MODEL_ROUTING_TASKS } from '@localixai/api/model-task-catalog'
import type { CatalogModel, ModelKind } from '@localixai/agent/catalog'
import { useModelsCatalog } from '@/shared/hooks/useModelsCatalog'
import type { PickerTarget } from './pickerTarget'
import type { useModelTaskRouting } from './useModelTaskRouting'

type Routing = ReturnType<typeof useModelTaskRouting>

/** The kind of model a picker target runs on: chat, unless its workload says otherwise. */
export function modelKindForTarget(target: PickerTarget): ModelKind {
  return MODEL_ROUTING_TASKS.find((task) => task.key === target)?.modelKind ?? 'chat'
}

/**
 * The models a workload lists — the kind it runs on: chat, or decision for group routing — and,
 * for every row, the models of that row's own kind, so each row's label resolves against its
 * kind alone.
 */
export function useWorkloadModels(chatModels: CatalogModel[], target: PickerTarget) {
  const { modelsOfKind } = useModelsCatalog()
  const modelsFor = useCallback(
    (key: PickerTarget) => {
      const kind = modelKindForTarget(key)
      return kind === 'chat' ? chatModels : modelsOfKind(kind)
    },
    [chatModels, modelsOfKind],
  )
  return { taskKind: modelKindForTarget(target), models: modelsFor(target), modelsFor }
}

/**
 * A workload with a catalog default (`defaultModelId`) runs it through any connection of its
 * provider; with no such connection it runs nothing, and its row says what would turn it on
 * instead of naming a model that will not run. Every other label passes through unchanged.
 */
export function useWorkloadDefaults(
  routing: Routing,
  connections: ReadonlyArray<{
    id: string
    providerId: string
    keys?: ReadonlyArray<{ enabled: boolean }>
  }>,
): Routing {
  const { modelsOfKind } = useModelsCatalog()
  const unservedDefault = useCallback(
    (key: PickerTarget): string | null => {
      const task = MODEL_ROUTING_TASKS.find((entry) => entry.key === key)
      const defaultId = task && 'defaultModelId' in task ? task.defaultModelId : undefined
      if (!defaultId) return null
      const model = modelsOfKind(modelKindForTarget(key)).find((entry) => entry.id === defaultId)
      if (!model) return null
      // Served the way the server serves it: a connection of the provider with an enabled key.
      const served = connections.some(
        (c) => c.providerId === model.providerId && (c.keys?.some((key) => key.enabled) ?? true),
      )
      return served ? null : `Connect ${model.providerName} to use`
    },
    [connections, modelsOfKind],
  )
  return useMemo(
    () => ({
      ...routing,
      modelLabelFor: (key: PickerTarget) => routing.modelLabelFor(key) ?? unservedDefault(key),
    }),
    [routing, unservedDefault],
  )
}
