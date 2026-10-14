/**
 * Pure model for the rail's RECENTS slots — the Dock-style companion to
 * {@link ./railLayout railLayout}.
 *
 * The two are deliberately separate stores. `railLayout` is ARRANGEMENT: the user
 * placed this entry here, and its invariant is a full canonical placement of every
 * known id. Recents are USAGE: opening an unpinned plugin view floats it into the
 * rail for a while, newest first, capped. A recent id therefore has to be in the
 * layout's `overflow` bucket AND rendered in the bar at the same time — which is
 * exactly the invariant `resolveRailAreas` must not lose. So recency lives here,
 * in its own storage key, and the rail renders the union.
 *
 * State keeps REFERENCES, not snapshots: an id whose
 * plugin got disabled stays in the list and is filtered out at resolve time, so
 * re-enabling the plugin restores its slot instead of silently forgetting it.
 */

import { pushMru } from '@/shared/lib/mru'

/**
 * How many recent views the dock remembers. It used to be three, the macOS Dock's
 * default, because every slot sat in the rail and a fourth icon was a fourth piece
 * of noise. The dock now keeps them collapsed behind one button (railRecentsPref),
 * so depth costs nothing at rest and a real history is worth more than a hint.
 */
export const MAX_RAIL_RECENTS = 10

/** localStorage key holding the serialized {@link RailRecentsState}. */
export const RAIL_RECENTS_STORAGE_KEY = 'localix_rail_recents'

/** Bumped when the persisted shape changes. */
export const RAIL_RECENTS_VERSION = 1

/** Entry ids most-recently opened first. May hold ids that no longer exist. */
export interface RailRecentsState {
  ids: string[]
}

/** The empty (nothing opened yet) state. */
export function emptyRailRecents(): RailRecentsState {
  return { ids: [] }
}

/** Move `id` to the front, deduped, capped to {@link MAX_RAIL_RECENTS}. */
export function touchRecent(state: RailRecentsState | null, id: string): RailRecentsState {
  return { ids: pushMru(state?.ids ?? [], id, MAX_RAIL_RECENTS) }
}

/**
 * Drop `id` outright. Pinning calls this: display-time filtering alone would let
 * a pinned id squat an MRU slot and evict a genuine recent.
 */
export function removeRecent(state: RailRecentsState | null, id: string): RailRecentsState {
  return { ids: (state?.ids ?? []).filter((entry) => entry !== id) }
}

/**
 * The ids actually rendered as recent slots: recency order, minus anything the
 * user pinned (it already has a permanent slot) and anything no longer available
 * (a disabled or uninstalled plugin).
 */
export function resolveRecents(
  state: RailRecentsState | null,
  knownIds: ReadonlySet<string>,
  pinnedIds: ReadonlySet<string>,
): string[] {
  const out: string[] = []
  for (const id of state?.ids ?? []) {
    if (out.length >= MAX_RAIL_RECENTS) break
    if (!knownIds.has(id) || pinnedIds.has(id) || out.includes(id)) continue
    out.push(id)
  }
  return out
}

/**
 * Parse a raw storage value. NEVER throws — a malformed or foreign value yields
 * `null` (start empty) so a corrupt entry can't break the workspace shell.
 */
export function parseRailRecents(raw: string | null): RailRecentsState | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const ids = (data as Record<string, unknown>).ids
  if (!Array.isArray(ids)) return null
  const seen = new Set<string>()
  for (const id of ids) {
    if (typeof id === 'string' && id.length > 0) seen.add(id)
  }
  return { ids: [...seen].slice(0, MAX_RAIL_RECENTS) }
}

/** Serialize for storage (adds the version envelope). */
export function serializeRailRecents(state: RailRecentsState): string {
  return JSON.stringify({ v: RAIL_RECENTS_VERSION, ids: state.ids })
}
