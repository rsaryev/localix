/**
 * The status view of semantic search: a pure projection of the service's state (what the
 * status bar, the picker and search read), kept apart so the service holds behaviour.
 */
import type { InstallJob, LocalModelsStatus } from '../local-models/contracts'
import type { SemanticStatus } from './contracts'
import type { IndexerProgress } from './indexer'
import type { EmbeddingModelSpec } from './models'

const ACTIVE_JOB = new Set(['queued', 'downloading', 'verifying'])

export function buildSemanticStatus(input: {
  enabled: boolean
  model: EmbeddingModelSpec
  installed: boolean
  counts: Map<string, { items: number; chunks: number }>
  progress: IndexerProgress
  pending: number
  local: LocalModelsStatus
  job: InstallJob | null
  engine: SemanticStatus['engine']
}): SemanticStatus {
  const { model, counts, progress, job, local } = input
  let items = 0
  let chunks = 0
  for (const c of counts.values()) {
    items += c.items
    chunks += c.chunks
  }
  return {
    supported: local.runtime.supported,
    enabled: input.enabled,
    model: {
      id: model.id,
      label: model.label,
      attribution: model.attribution,
      providerId: model.source.kind === 'local' ? 'local' : model.source.providerId,
      bytes: model.source.kind === 'local' ? model.source.local.bytes : 0,
      installed: input.installed,
    },
    runtime: local.runtime.tag
      ? { tag: local.runtime.tag, installed: local.runtime.installed }
      : null,
    install: {
      state:
        job && ACTIVE_JOB.has(job.phase)
          ? 'downloading'
          : job?.phase === 'failed'
            ? 'failed'
            : 'idle',
      received: job?.received ?? 0,
      total: job?.total ?? 0,
      error: job?.error ?? null,
    },
    engine: input.engine,
    index: {
      phase: progress.phase,
      items,
      chunks,
      pendingChanges: input.pending,
      chunksPerSecond: progress.chunksPerSecond,
      lastError: progress.lastError,
      collections: progress.collections.map((c) => ({
        name: c.collection,
        label: c.label,
        items: counts.get(c.collection)?.items ?? 0,
        chunks: counts.get(c.collection)?.chunks ?? 0,
        scanned: c.scanned,
        total: c.total,
        reconciling: c.reconciling,
      })),
    },
  }
}
