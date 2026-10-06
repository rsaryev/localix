/**
 * The roster's live stream on the realtime socket: what the backend PUSHES to an open roster.
 *
 * The panel used to find out by looking — every tick re-enumerated four history roots (a readdir
 * and a stat per session file, ~2,000 of them here) and re-read the providers list, whether or not
 * anything had been written since. Now the backend watches those roots and says when they moved:
 *
 * - `{ changed: true }`: an agent wrote to its history; re-read the roster. Coalesced, so a busy
 *   agent appending every second costs one re-read per window, not one per line.
 * - `{ live: boolean }`: whether the watch is armed. `false` (no root could be watched, or a
 *   watcher failed) means the panel must keep finding out by looking, at its usual cadence.
 */
export const HISTORY_FRAME_TAG = 'e'
export const HISTORY_SUBSCRIBE = 'external-agents:history:subscribe'
export const HISTORY_UNSUBSCRIBE = 'external-agents:history:unsubscribe'

export type HistoryFrame = { readonly changed: true } | { readonly live: boolean }

/** A frame from the wire, or null for anything that is not one. */
export function parseHistoryFrame(json: string): HistoryFrame | null {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const frame = value as { changed?: unknown; live?: unknown }
  if (frame.changed === true) return { changed: true }
  if (typeof frame.live === 'boolean') return { live: frame.live }
  return null
}
