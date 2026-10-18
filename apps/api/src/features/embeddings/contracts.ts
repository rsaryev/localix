/**
 * Wire contracts of `/rpc/semantic` and the strategy note every search response carries.
 * The UI reads these through the typed client; nothing here has behaviour.
 */
import type { EngineState } from './engine'
import type { IndexerPhase } from './indexer'

export type InstallState = 'idle' | 'downloading' | 'failed'

export interface SemanticCollectionStatus {
  name: string
  /** What its source calls these items (`Messages`); collections come and go with plugins. */
  label: string
  items: number
  chunks: number
  /** While a reconcile runs: items visited and the source's own count (null when unknown). */
  scanned: number | null
  total: number | null
  reconciling: boolean
}

export interface SemanticStatus {
  /** False where no runtime build exists for this OS/CPU. */
  supported: boolean
  enabled: boolean
  model: {
    id: string
    label: string
    attribution: string
    /** `local` for a model on this computer, else the cloud provider indexing goes to. */
    providerId: string
    bytes: number
    installed: boolean
  }
  runtime: { tag: string; installed: boolean } | null
  install: {
    state: InstallState
    received: number
    total: number
    error: string | null
  }
  engine: { state: EngineState; error: string | null }
  index: {
    phase: IndexerPhase
    items: number
    chunks: number
    pendingChanges: number
    chunksPerSecond: number | null
    lastError: string | null
    collections: SemanticCollectionStatus[]
  }
}

/**
 * Which strategy answered a search. `hybrid` = words + meaning; `lexical` = words only, with
 * the reason meaning was not used so the UI can say "meaning search is warming up" instead of
 * silently returning a weaker answer.
 */
export interface SearchStrategyNote {
  mode: 'lexical' | 'hybrid'
  reason?: 'off' | 'not-installed' | 'starting' | 'unavailable'
  /** Hybrid while the index is still being built: results may be incomplete. */
  indexing?: boolean
}

/** One embedding model semantic search can be set to, as the model picker lists it. */
export interface EmbeddingChoice {
  id: string
  label: string
  attribution: string
  /** `local`, or the provider whose connection embeds with it. */
  providerId: string
  releasedAt: string | null
  dimensions: number
  indexDimensions: number
  /** On this computer (a provider's is always ready). */
  installed: boolean
  /** Download size, for a local model. */
  bytes: number | null
  active: boolean
  recommended: boolean
}
