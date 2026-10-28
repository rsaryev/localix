/**
 * Where composerBus keeps the inserts it HOLDS, so a reload cannot lose them.
 *
 * A held insert is words the person wrote and cannot get back any other way (a stopped session's
 * queue, which the server has already emptied). It waits in memory for the addressed composer —
 * a child or subagent session may stay closed for as long as the page lives — so a reload of the
 * page or the desktop window used to drop it for good. The list is mirrored to browser storage
 * on every change and read back on the next load; a delivered or retracted entry leaves it.
 *
 * Only what survives JSON travels: text and bindings. Storage that is missing, full or corrupt
 * makes this a no-op, never a failure of the insert itself.
 */
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import type { ComposerInsert } from './composerBus'

const STORAGE_KEY = 'localix_composer_held_inserts_v1'

/** The part of an insert that is stored: who it is for, and what the person wrote. */
export type HeldInsert = Pick<ComposerInsert, 'sessionId' | 'text' | 'bindings'>

export function loadHeldInserts(): HeldInsert[] {
  const raw = loadJSON<unknown>(STORAGE_KEY)
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry): HeldInsert[] => {
    const held = entry as Partial<HeldInsert> | null
    if (typeof held?.sessionId !== 'string' || !held.sessionId) return []
    const text = typeof held.text === 'string' ? held.text : undefined
    const bindings = Array.isArray(held.bindings) ? held.bindings : undefined
    if (!text && !bindings?.length) return []
    return [
      { sessionId: held.sessionId, ...(text ? { text } : {}), ...(bindings ? { bindings } : {}) },
    ]
  })
}

export function saveHeldInserts(held: readonly HeldInsert[]): void {
  saveJSON(
    STORAGE_KEY,
    held.length > 0
      ? held.map(({ sessionId, text, bindings }) => ({
          sessionId,
          ...(text ? { text } : {}),
          ...(bindings?.length ? { bindings } : {}),
        }))
      : null,
  )
}
