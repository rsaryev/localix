import type { SemanticSource } from '@localixai/mini-app-sdk/backend'
import type { SemanticStore } from './store'
import type { VectorCache } from './vector-cache'

export type IndexerPhase = 'stopped' | 'idle' | 'reconciling' | 'updating' | 'retrying' | 'paused'

export interface CollectionProgress {
  collection: string
  label: string
  /** Items a running reconcile has visited / will visit (null when the source cannot count). */
  scanned: number | null
  total: number | null
  reconciling: boolean
}

export interface IndexerProgress {
  phase: IndexerPhase
  collections: CollectionProgress[]
  pendingChanges: number
  /** Chunks embedded per second over the last half minute (null before the first batch). */
  chunksPerSecond: number | null
  lastError: string | null
}

export interface IndexerDeps {
  store: SemanticStore
  cache: VectorCache
  sources: () => readonly SemanticSource[]
  onProgress?: () => void
  log?: (event: string, fields: Record<string, unknown>) => void
  /** Waits between scan pages, so a reconcile stays in the background. Test seam. */
  pace?: () => Promise<void>
  /** Arms the retry after a failed pass; returns its cancel. Test seam. */
  setTimer?: (fire: () => void, ms: number) => () => void
}
