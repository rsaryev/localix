import useSWR from 'swr'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { localModelsApi, type InstallJob, type LocalModelKind } from '@/shared/api/localModelsApi'
import { semanticApi } from '@/shared/api/semanticApi'
import { useRevalidateOnResources } from '@/shared/api/resourceGeneration'

const LOCAL_MODELS_STATUS_KEY = 'local-models-status'
const SEMANTIC_STATUS_KEY = 'semantic-status'

/**
 * What is installed, downloading and running — shared by Settings and the model picker. The server
 * pokes `local-models` as a download moves (at most once a second), and the status is read again.
 */
export function useLocalModelsStatus(enabled = true) {
  const visible = useWorkItemVisible()
  useRevalidateOnResources(LOCAL_MODELS_STATUS_KEY, ['local-models'])
  const { data, error, mutate } = useSWR(visible && enabled ? LOCAL_MODELS_STATUS_KEY : null, () =>
    localModelsApi.status(),
  )
  const jobOf = (modelId: string): InstallJob | undefined =>
    data?.jobs.find((j) => j.modelId === modelId)
  return { status: data, error, refresh: mutate, jobOf }
}

/** The catalog: the curated list, or the builds of a model added by its id (`Qwen/Qwen3-8B`). */
export function useLocalModelCatalog(id: string, kind?: LocalModelKind, enabled = true) {
  const asked = id.trim()
  const { data, error, isLoading, mutate } = useSWR(
    enabled ? ['local-models-catalog', asked, kind ?? ''] : null,
    () => localModelsApi.catalog({ ...(asked ? { id: asked } : {}), ...(kind ? { kind } : {}) }),
  )
  return { entries: data ?? [], error, isLoading, refresh: mutate }
}

/** The recommended local models: Gemma 4 at the size that suits this computer, and embeddings. */
export function useRecommendedLocalModels() {
  const { data, isLoading, mutate } = useSWR('local-models-recommended', () =>
    localModelsApi.recommended(),
  )
  return { entries: data ?? [], isLoading, refresh: mutate }
}

/** One local model in detail: its exact files and how it runs here (read once, then cached). */
export function useLocalModelDetails(id: string | null) {
  const { data, isLoading } = useSWR(id ? ['local-model', id] : null, () =>
    localModelsApi.model(id!),
  )
  return { entry: data ?? null, isLoading }
}

/** Semantic search: the embedding model's download and the index build, poked as `semantic`. */
export function useSemanticStatus() {
  const visible = useWorkItemVisible()
  useRevalidateOnResources(SEMANTIC_STATUS_KEY, ['semantic'])
  const { data, error, mutate } = useSWR(visible ? SEMANTIC_STATUS_KEY : null, () =>
    semanticApi.status(),
  )
  return { status: data, error, refresh: mutate }
}
