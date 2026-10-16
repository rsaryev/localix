import type { ModelsStore, ModelsStoreEntry } from '@earendil-works/pi-ai'
import { getBuiltinModelDataGeneratedAt } from '@earendil-works/pi-ai/providers/all'
import { isModelsStoreEntry } from '@earendil-works/pi-ai/providers/model-entry-schema'

import type { EngineCatalogStore } from '@localixai/agent/runtime'

/**
 * The catalog build an entry belongs to: the checked-in generated data it overlays. The conversion
 * ships with that data, so an entry another build wrote may hold models this build would convert
 * differently, and is dropped rather than overlaid on a newer baseline.
 */
export function piCatalogBuild(): string {
  return `generated-${getBuiltinModelDataGeneratedAt() ?? 'unknown'}`
}

interface StoredEnvelope {
  build: string
  entry: ModelsStoreEntry
}

function isEnvelope(value: unknown, build: string): value is StoredEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const envelope = value as Partial<StoredEnvelope>
  return envelope.build === build && isModelsStoreEntry(envelope.entry)
}

/**
 * pi's `ModelsStore` over the host's opaque store. What is read back is checked against pi's own
 * model schema; an entry that fails it, belongs to another build, or cannot be read is treated as
 * absent (and removed when it exists), so a provider never restores data it would not have
 * produced itself.
 */
export function createPiModelsStore(
  store: EngineCatalogStore,
  options: { build?: string; onDropped?: (providerId: string, reason: string) => void } = {},
): ModelsStore {
  const build = options.build ?? piCatalogBuild()
  return {
    async read(providerId, operation) {
      operation?.signal?.throwIfAborted()
      let value: unknown
      try {
        value = await store.read(providerId)
      } catch (error) {
        options.onDropped?.(providerId, error instanceof Error ? error.message : String(error))
        return undefined
      }
      if (value === undefined) return undefined
      if (isEnvelope(value, build)) return value.entry
      options.onDropped?.(providerId, 'stale or invalid entry')
      await store.delete(providerId).catch(() => {})
      return undefined
    },
    async write(providerId, entry, operation) {
      operation?.signal?.throwIfAborted()
      await store.write(providerId, { build, entry } satisfies StoredEnvelope)
    },
    async delete(providerId, operation) {
      operation?.signal?.throwIfAborted()
      await store.delete(providerId)
    },
  }
}
