import type { SemanticStatus } from '@/shared/api/semanticApi'
import { etaLabel } from '@/shared/lib/localModelsFormat'

/** What the index is doing, in one line, with its progress when it is building. */
export function indexLine(status: SemanticStatus): { text: string; percent: number | null } {
  const { index } = status
  const building = index.collections.find((c) => c.reconciling)
  if (building) {
    const percent =
      building.total && building.total > 0
        ? Math.round(((building.scanned ?? 0) / building.total) * 100)
        : null
    const left = building.total ? building.total - (building.scanned ?? 0) : 0
    const rate = index.chunksPerSecond ? `${index.chunksPerSecond} chunks/s` : null
    const eta = etaLabel(left, index.chunksPerSecond)
    return {
      text: [
        index.phase === 'paused' ? 'Indexing paused' : 'Building the index',
        percent === null ? null : `${percent}%`,
        rate,
        eta,
      ]
        .filter(Boolean)
        .join(' · '),
      percent,
    }
  }
  if (index.phase === 'updating')
    return { text: `Indexing ${index.pendingChanges} new changes…`, percent: null }
  if (index.phase === 'paused') return { text: 'Indexing paused', percent: null }
  if (index.phase === 'retrying')
    return { text: `Indexing will retry: ${index.lastError ?? 'it failed'}`, percent: null }
  return { text: `${index.items} items indexed`, percent: null }
}

/** Changes waiting before an update pass is worth showing. */
const UPDATE_BACKLOG = 20

export type IndexActivity =
  | 'off'
  | 'idle'
  | 'downloading'
  | 'building'
  | 'updating'
  | 'paused'
  | 'failed'

/**
 * What the status bar says about semantic search, in a word or two: off, indexed, or the work in
 * hand. Short changes are not worth a flicker, so an `updating` pass shows only with a backlog.
 * Null where it cannot run (no runtime for this computer).
 */
export function indexActivity(
  status: SemanticStatus,
): { activity: IndexActivity; label: string; percent: number | null } | null {
  if (!status.supported) return null
  if (!status.enabled) return { activity: 'off', label: 'Indexing off', percent: null }
  const { install, index, engine } = status
  if (install.state === 'downloading') {
    const percent = install.total > 0 ? Math.round((install.received / install.total) * 100) : null
    return { activity: 'downloading', label: 'Search model', percent }
  }
  if (install.state === 'failed' || engine.state === 'error' || index.phase === 'retrying')
    return { activity: 'failed', label: 'Index error', percent: null }
  const line = indexLine(status)
  if (index.phase === 'paused')
    return { activity: 'paused', label: 'Indexing paused', percent: line.percent }
  if (index.phase === 'reconciling')
    return { activity: 'building', label: 'Indexing', percent: line.percent }
  if (index.phase === 'updating' && index.pendingChanges >= UPDATE_BACKLOG)
    return { activity: 'updating', label: 'Indexing', percent: null }
  return { activity: 'idle', label: 'Indexed', percent: null }
}
