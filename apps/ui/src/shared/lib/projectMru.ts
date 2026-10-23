/**
 * Project MRU (most-recently-used) history — the "Open Recent" ordering behind
 * the project quick-switcher (⌘/Ctrl+⌥+P). Each project the user switches TO is
 * recorded, and the switcher list is surfaced recent-first.
 *
 * Ordering is delegated to the shared pure `pushMru` primitive; this module only
 * adds a small localStorage-backed singleton so recency survives reloads. Stale
 * ids (deleted projects) are dropped by the consumer, which resolves ids against
 * the live project list.
 */

import { pushMru } from './mru'
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'

const STORAGE_KEY = 'localix.project.mru'
export const PROJECT_MRU_CAP = 8

function read(): string[] {
  const parsed = loadJSON<unknown>(STORAGE_KEY)
  if (!Array.isArray(parsed)) return []
  return parsed.filter((v): v is string => typeof v === 'string').slice(0, PROJECT_MRU_CAP)
}

function write(list: string[]): void {
  saveJSON(STORAGE_KEY, list)
}

/** Current project ids in most-recently-switched-to order (most-recent first). */
export function getProjectMru(): string[] {
  return read()
}

/** Record that a project became active, moving it to the front of the MRU list. */
export function recordProjectUse(id: string): void {
  write(pushMru(read(), id, PROJECT_MRU_CAP))
}

/**
 * Order a project id list by MRU: recently-used ids first (in MRU order), then
 * any remaining ids in their original order. Pure — the caller passes the live
 * id list and the current MRU history, so removed projects never linger.
 */
export function orderByMru(ids: readonly string[], mru: readonly string[]): string[] {
  const present = new Set(ids)
  const recent = mru.filter((id) => present.has(id))
  const recentSet = new Set(recent)
  const rest = ids.filter((id) => !recentSet.has(id))
  return [...recent, ...rest]
}
