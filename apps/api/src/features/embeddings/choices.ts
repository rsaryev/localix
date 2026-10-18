/**
 * The embedding models a person can pick for semantic search, read live: this computer's that are
 * installed (found and downloaded in Settings → Models), each connected provider's from its
 * own model list. One per family on this computer — its newest — since an older generation of a
 * family is the same trade at lower quality. Providers' models are discovered with the person's key and cached.
 */
import type { LocalModelsService } from '../local-models/service'
import type { EmbeddingChoice } from './contracts'
import { familyOf } from './families'
import {
  DEFAULT_EMBEDDING_MODEL_ID,
  localEmbeddingModel,
  providerEmbeddingModel,
  type EmbeddingModelSpec,
} from './models'
import {
  discoverProviderModels,
  PROVIDER_EMBEDDINGS,
  type DiscoveredModel,
} from './provider-embeddings'

const DISCOVERY_TTL_MS = 6 * 60 * 60_000

export const LOCAL_PROVIDER_ID = 'local'

function toChoice(
  spec: EmbeddingModelSpec,
  extra: Pick<EmbeddingChoice, 'providerId' | 'installed' | 'bytes'>,
  activeId: string,
): EmbeddingChoice {
  return {
    id: spec.id,
    label: spec.label,
    attribution: spec.attribution,
    releasedAt: spec.releasedAt,
    dimensions: spec.dimensions,
    indexDimensions: spec.indexDimensions,
    active: spec.id === activeId,
    recommended: spec.id === DEFAULT_EMBEDDING_MODEL_ID,
    ...extra,
  }
}

export function createEmbeddingChoices(deps: {
  localModels: { catalog: Pick<LocalModelsService['catalog'], 'list'> }
  /** Providers `userId` is connected to with an API key, and that key. */
  providerKeys: (userId: string) => Promise<Map<string, string>>
  fetchImpl?: typeof fetch
  now?: () => number
}) {
  const clock = deps.now ?? Date.now
  const discovered = new Map<string, { at: number; models: DiscoveredModel[] }>()

  async function providerModels(providerId: string, key: string): Promise<DiscoveredModel[]> {
    const provider = PROVIDER_EMBEDDINGS.find((p) => p.providerId === providerId)
    if (!provider) return []
    const cached = discovered.get(providerId)
    if (cached && clock() - cached.at < DISCOVERY_TTL_MS) return cached.models
    try {
      const models = await discoverProviderModels(provider, key, deps.fetchImpl)
      discovered.set(providerId, { at: clock(), models })
      return models
    } catch {
      return cached?.models ?? []
    }
  }

  async function local(activeId: string): Promise<EmbeddingChoice[]> {
    const entries = await deps.localModels.catalog.list({ kind: 'embedding' })
    const newestPerFamily = new Map<string, EmbeddingChoice>()
    for (const entry of entries) {
      // On this computer: only what is installed (Settings → Models gets the rest).
      if (!entry.installed) continue
      const spec = localEmbeddingModel(entry.spec)
      const family = familyOf(entry.spec.repo)
      if (!spec || !family) continue
      const choice = toChoice(
        spec,
        { providerId: LOCAL_PROVIDER_ID, installed: entry.installed, bytes: entry.spec.bytes },
        activeId,
      )
      const kept = newestPerFamily.get(family.key)
      // Entries arrive newest first; an installed or chosen older one is kept beside it.
      if (!kept) newestPerFamily.set(family.key, choice)
      else if (choice.installed || choice.active)
        newestPerFamily.set(`${family.key}:${spec.id}`, choice)
    }
    return [...newestPerFamily.values()]
  }

  return {
    async list(userId: string, activeId: string): Promise<EmbeddingChoice[]> {
      const keys = await deps.providerKeys(userId).catch(() => new Map<string, string>())
      const cloud = await Promise.all(
        [...keys].map(async ([providerId, key]) =>
          (await providerModels(providerId, key)).flatMap((m) => {
            const spec = providerEmbeddingModel(`${providerId}/${m.model}`, m.releasedAt, m.name)
            return spec
              ? [toChoice(spec, { providerId, installed: true, bytes: null }, activeId)]
              : []
          }),
        ),
      )
      const byDate = (a: EmbeddingChoice, b: EmbeddingChoice) =>
        (b.releasedAt ?? '').localeCompare(a.releasedAt ?? '')
      return [...(await local(activeId)), ...cloud.flat().sort(byDate)]
    },
  }
}

export type EmbeddingChoices = ReturnType<typeof createEmbeddingChoices>
