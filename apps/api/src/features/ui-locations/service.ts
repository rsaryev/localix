import { createHash } from 'node:crypto'
import {
  normalizeUiAgentLocationCatalogSnapshot,
  type UiAgentLocationCatalogSnapshot,
} from '@localixai/plugin-sdk/ui'

import { createBoundedCache, type BoundedCache } from '../../lib/bounded-cache'

const MAX_CACHED_SNAPSHOTS = 256
const MAX_PUBLISHER_SCOPES = 256
const MAX_PUBLISHERS_PER_SCOPE = 16

interface PublisherState {
  revision: number
  catalogId: string
}

interface StoredCatalog {
  snapshot: UiAgentLocationCatalogSnapshot
}

export interface PublishUiLocationCatalogInput {
  userId: string
  publisherId: string
  projectId: string | null
  catalog: unknown
}

export type PublishUiLocationCatalogResult =
  | { status: 'accepted' | 'unchanged' | 'stale'; catalogId: string }
  | { status: 'conflict' }
  | { status: 'invalid' }

export interface UiLocationCatalogService {
  publish(input: PublishUiLocationCatalogInput): PublishUiLocationCatalogResult
  get(
    userId: string,
    projectId: string | null,
    catalogId: string,
  ): UiAgentLocationCatalogSnapshot | null
}

function scopeKey(userId: string, projectId: string | null): string {
  return `${userId}\u0000${projectId ?? ''}`
}

function snapshotKey(userId: string, projectId: string | null, catalogId: string): string {
  return `${scopeKey(userId, projectId)}\u0000${catalogId}`
}

function catalogIdFor(snapshot: UiAgentLocationCatalogSnapshot): string {
  const canonical = JSON.stringify({
    version: snapshot.version,
    locations: snapshot.locations,
  })
  return `ui1_${createHash('sha256').update(canonical).digest('base64url').slice(0, 32)}`
}

/** Process-local, immutable, content-addressed catalogs bound to one user/project scope. */
export function createUiLocationCatalogService(): UiLocationCatalogService {
  const snapshots = createBoundedCache<string, StoredCatalog>({ maxEntries: MAX_CACHED_SNAPSHOTS })
  const publishersByScope = createBoundedCache<string, BoundedCache<string, PublisherState>>({
    maxEntries: MAX_PUBLISHER_SCOPES,
  })

  const storeSnapshot = (
    userId: string,
    projectId: string | null,
    catalogId: string,
    snapshot: UiAgentLocationCatalogSnapshot,
  ) => {
    snapshots.set(snapshotKey(userId, projectId, catalogId), { snapshot })
  }

  const hasSnapshot = (userId: string, projectId: string | null, catalogId: string): boolean =>
    snapshots.has(snapshotKey(userId, projectId, catalogId))

  return {
    publish(input) {
      const snapshot = normalizeUiAgentLocationCatalogSnapshot(input.catalog)
      if (!snapshot) return { status: 'invalid' }
      const catalogId = catalogIdFor(snapshot)
      const scope = scopeKey(input.userId, input.projectId)
      // Reads arrive through publish, so this lookup refreshes the scope's LRU
      // position before applying its per-publisher revision ordering.
      let publishers = publishersByScope.get(scope)
      if (!publishers) {
        publishers = createBoundedCache({ maxEntries: MAX_PUBLISHERS_PER_SCOPE })
        publishersByScope.set(scope, publishers)
      }
      const previous = publishers.peek(input.publisherId)
      if (previous) {
        if (snapshot.revision < previous.revision) {
          if (hasSnapshot(input.userId, input.projectId, previous.catalogId)) {
            return { status: 'stale', catalogId: previous.catalogId }
          }
          // Snapshot LRU and publisher ordering have intentionally separate
          // lifetimes. Never return an immutable id whose payload was evicted:
          // accept this self-contained (albeit older) publication as the new
          // ordering baseline so the caller still binds its run to real data.
          publishers.delete(input.publisherId)
        }
        if (snapshot.revision === previous.revision) {
          if (previous.catalogId !== catalogId) return { status: 'conflict' }
          // A reconnect commonly republishes byte-identical content. Refresh
          // both the payload and its LRU position because publisher state may
          // outlive the globally bounded snapshot cache.
          storeSnapshot(input.userId, input.projectId, catalogId, snapshot)
          return { status: 'unchanged', catalogId }
        }
        publishers.delete(input.publisherId)
      }

      storeSnapshot(input.userId, input.projectId, catalogId, snapshot)
      publishers.set(input.publisherId, { revision: snapshot.revision, catalogId })
      return { status: 'accepted', catalogId }
    },

    get(userId, projectId, catalogId) {
      return snapshots.get(snapshotKey(userId, projectId, catalogId))?.snapshot ?? null
    },
  }
}
