/**
 * Recently-used models for the model picker.
 *
 * A dedicated "Recent" sidebar entry in the cross-provider model picker
 * (move-to-front, dedupe, cap): one click re-selects a model you used before
 * without navigating provider → model again.
 *
 * A recent entry is a (connectionId, modelId) pair — Localix picks are per
 * CONNECTION, not per provider, so two connections to the same provider stay
 * distinct. That makes it a VALUE object: ordering delegates to the shared
 * `pushMru` primitive with a pair-equality comparator. The singleton wraps it
 * with a best-effort localStorage store so history survives reloads. Stale
 * entries (connection removed / model gone) are filtered out at render time by
 * the caller.
 */

import { pushMru } from '@/shared/lib/mru'
import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'

export interface RecentModel {
  connectionId: string
  modelId: string
}

const STORAGE_KEY = 'localix.models.recent'
export const RECENT_MODELS_CAP = 6

/** Two entries are the same recent when BOTH ids match — same model on another
 *  connection is a distinct entry. */
function sameModel(a: RecentModel, b: RecentModel): boolean {
  return a.connectionId === b.connectionId && a.modelId === b.modelId
}

/** An entry is only addressable once both of its ids are non-empty; a blank id
 *  can never resolve against a live connection or catalog model. */
function isAddressable(entry: RecentModel): boolean {
  return entry.connectionId !== '' && entry.modelId !== ''
}

/**
 * Return a new recent list with `entry` moved to the front, de-duplicated and
 * capped. Pure — no I/O. Most-recent is index 0.
 */
export function promoteRecentModel(
  list: readonly RecentModel[],
  entry: RecentModel,
  cap = RECENT_MODELS_CAP,
): RecentModel[] {
  return pushMru(list, entry, cap, sameModel).filter(isAddressable)
}

function read(): RecentModel[] {
  const parsed = loadJSON<unknown>(STORAGE_KEY)
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter(
      (v): v is RecentModel =>
        !!v && typeof v.connectionId === 'string' && typeof v.modelId === 'string',
    )
    .slice(0, RECENT_MODELS_CAP)
}

function write(list: RecentModel[]): void {
  saveJSON(STORAGE_KEY, list)
}

/** Current recent models, most-recent first. */
export function getRecentModels(): RecentModel[] {
  return read()
}

/** Record that a model was picked, moving it to the front of the recent list. */
export function recordRecentModel(entry: RecentModel): void {
  write(promoteRecentModel(read(), entry))
}
