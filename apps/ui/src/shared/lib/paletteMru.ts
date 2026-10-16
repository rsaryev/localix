/**
 * Command-palette MRU (most-recently-used) history.
 *
 * Recently-run commands float to the top under a "recently used" separator.
 * Localix's palette groups commands by category, so this is a dedicated
 * "Recently used" group rendered at the top when the query is empty — the recent
 * ids are resolved against the live command list, so stale/removed ids drop out.
 *
 * The ordering primitive `promoteMru` is pure + unit-tested; the singleton wraps
 * it with a small localStorage-backed store so history survives reloads.
 */
import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'

const STORAGE_KEY = 'localix.palette.mru'
export const PALETTE_MRU_CAP = 6

/**
 * Return a new MRU list with `id` moved to the front (most recent), de-duplicated
 * and capped at `cap`. Pure — no I/O. Most-recent is index 0.
 */
export function promoteMru(list: readonly string[], id: string, cap = PALETTE_MRU_CAP): string[] {
  const next = [id, ...list.filter((existing) => existing !== id)]
  return next.slice(0, Math.max(0, cap))
}

function read(): string[] {
  const parsed = loadJSON<unknown>(STORAGE_KEY)
  if (!Array.isArray(parsed)) return []
  return parsed.filter((v): v is string => typeof v === 'string').slice(0, PALETTE_MRU_CAP)
}

function write(list: string[]): void {
  saveJSON(STORAGE_KEY, list)
}

/** Current MRU command ids, most-recent first. */
export function getPaletteMru(): string[] {
  return read()
}

/** Record that a palette command was run, moving it to the front of the MRU list. */
export function recordPaletteUse(id: string): void {
  write(promoteMru(read(), id))
}
