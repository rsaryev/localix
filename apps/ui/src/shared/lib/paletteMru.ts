/**
 * Command-palette MRU (most-recently-used) history.
 *
 * Recently-run commands float to the top under a "recently used" separator.
 * Localix's palette groups commands by category, so this is a dedicated
 * "Recently used" group rendered at the top when the query is empty — the recent
 * ids are resolved against the live command list, so stale/removed ids drop out.
 *
 * Ordering is the shared `pushMru`; this module keeps the list in localStorage so
 * history survives reloads.
 */
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import { pushMru } from './mru'

const STORAGE_KEY = 'localix.palette.mru'
const PALETTE_MRU_CAP = 6

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
  write(pushMru(read(), id, PALETTE_MRU_CAP))
}
