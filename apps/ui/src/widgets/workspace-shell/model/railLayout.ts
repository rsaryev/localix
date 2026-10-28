/**
 * Pure model for the CUSTOMIZABLE workspace rail.
 *
 * The rail's visible workspace and lower zones are user-arrangeable: every
 * customizable entry can live in the centered bar, the lower bar, or the Capabilities
 * overflow, and visible entries can be reordered. This module owns
 * that arrangement as data — resolution, moves, and localStorage (de)serialization
 * — with ZERO React/DOM so it can be unit-tested in isolation.
 *
 * Design:
 *  - The set of available entries (`RailItemDef[]`) is computed fresh each render
 *    from the live rail sources; ids are STABLE and namespaced (`section:files`,
 *    `viewlet:stats`, …). The saved state references entries by id.
 *  - The saved state is a full, canonical placement: after any move it lists every
 *    currently-known entry with its area, in display order. Stale ids (an entry
 *    that no longer exists) are dropped on the next canonicalize; brand-new entries
 *    (a freshly installed mini app panel) are appended to their DEFAULT area in def
 *    order — so the rail degrades gracefully as the available set changes.
 */

import type {
  RailArea,
  PinnedRailArea,
  RailItemDef,
  RailPlacement,
  RailLayoutState,
} from './railLayoutTypes'
export type {
  RailArea,
  PinnedRailArea,
  RailItemDef,
  RailPlacement,
  RailLayoutState,
} from './railLayoutTypes'

export { RAIL_LAYOUT_STORAGE_KEY, parseRailLayout, serializeRailLayout } from './railLayoutStorage'

/** The page-level "Reset layout" action broadcasts this window event (it already
 *  nudges the sidebar-width hook the same way) — the rail-layout hook listens too,
 *  because users read "Reset layout" as EVERYTHING, icons included. */
export const RAIL_LAYOUT_RESET_EVENT = 'localix:reset-layout'

/** The empty (defaults) layout — nothing explicitly placed. */
export function emptyRailLayout(): RailLayoutState {
  return { entries: [] }
}

/**
 * Resolve saved state against the CURRENT set of entries into the ordered id lists
 * actually rendered.
 *
 * 1. Walk saved entries in order; keep those whose id still exists, in their saved
 *    area. 2. Append any def not covered by saved state to its `defaultArea`, in
 *    def order. The result contains EXACTLY the current def ids (no stale, no
 *    missing).
 *
 * A def with `placeable: false` is forced into `overflow` in both passes — see that
 * field's note: honoring a stale saved placement there would strand an icon on the
 * rail with nothing left to remove it.
 */
export function resolveRailAreas(
  defs: RailItemDef[],
  state: RailLayoutState | null,
): { top: string[]; bar: string[]; bottom: string[]; status: string[]; overflow: string[] } {
  const known = new Map(defs.map((d) => [d.id, d]))
  const top: string[] = []
  const bar: string[] = []
  const bottom: string[] = []
  const status: string[] = []
  const overflow: string[] = []
  const placed = new Set<string>()
  const target = { top, bar, bottom, status, overflow }

  for (const entry of state?.entries ?? []) {
    const saved = known.get(entry.id)
    if (placed.has(entry.id) || !saved) continue
    placed.add(entry.id)
    target[saved.placeable === false ? 'overflow' : entry.area].push(entry.id)
  }
  for (const def of defs) {
    if (placed.has(def.id)) continue
    placed.add(def.id)
    target[def.placeable === false ? 'overflow' : def.defaultArea].push(def.id)
  }
  return { top, bar, bottom, status, overflow }
}

/** Serialize resolved areas back into a full, canonical placement list. */
function canonicalEntries(
  top: string[],
  bar: string[],
  bottom: string[],
  status: string[],
  overflow: string[],
): RailLayoutState {
  return {
    entries: [
      ...top.map((id): RailPlacement => ({ id, area: 'top' })),
      ...bar.map((id): RailPlacement => ({ id, area: 'bar' })),
      ...bottom.map((id): RailPlacement => ({ id, area: 'bottom' })),
      ...status.map((id): RailPlacement => ({ id, area: 'status' })),
      ...overflow.map((id): RailPlacement => ({ id, area: 'overflow' })),
    ],
  }
}

/**
 * Move `id` into `area` at `index` (index measured in the destination list AFTER
 * the moved id is removed from wherever it was). Index is clamped; an unknown id
 * is a no-op. Returns a NEW canonical state.
 */
export function moveRailItem(
  defs: RailItemDef[],
  state: RailLayoutState | null,
  id: string,
  area: RailArea,
  index: number,
): RailLayoutState {
  if (!defs.some((d) => d.id === id)) return state ?? emptyRailLayout()
  const resolved = resolveRailAreas(defs, state)
  const top = resolved.top.filter((x) => x !== id)
  const bar = resolved.bar.filter((x) => x !== id)
  const bottom = resolved.bottom.filter((x) => x !== id)
  const status = resolved.status.filter((x) => x !== id)
  const overflow = resolved.overflow.filter((x) => x !== id)
  const areas = { top, bar, bottom, status, overflow }
  const target = areas[area]
  const at = Math.max(0, Math.min(index, target.length))
  target.splice(at, 0, id)
  return canonicalEntries(top, bar, bottom, status, overflow)
}

/**
 * Nudge `id` by `delta` positions WITHIN the bar (keyboard "Move up/down").
 * Clamped at the edges; an id not currently on the bar (or unknown) is a no-op.
 * Returns a NEW canonical state.
 */
export function moveWithinBar(
  defs: RailItemDef[],
  state: RailLayoutState | null,
  id: string,
  delta: number,
): RailLayoutState {
  return moveWithinRailArea(defs, state, id, 'bar', delta)
}

/** Nudge an entry within a visible rail area. */
export function moveWithinRailArea(
  defs: RailItemDef[],
  state: RailLayoutState | null,
  id: string,
  area: PinnedRailArea,
  delta: number,
): RailLayoutState {
  const ids = resolveRailAreas(defs, state)[area]
  const from = ids.indexOf(id)
  if (from < 0) return state ?? emptyRailLayout()
  const to = Math.max(0, Math.min(from + delta, ids.length - 1))
  // `moveRailItem` measures the index after removal; the clamped absolute
  // position of a within-area move maps to that index directly.
  return moveRailItem(defs, state, id, area, to)
}

/** Reset EVERYTHING (order + areas for all kinds) back to defaults. */
export function resetRailLayout(): RailLayoutState {
  return emptyRailLayout()
}

/**
 * Where a dragged row lands, re-exported from the shared primitive.
 *
 * The rail wrote this first and it is not rail-shaped: any vertical list reordered by drag
 * needs the same answer, and the off-by-one it avoids is the same off-by-one everywhere.
 * `shared/ui/list-reorder` owns it now; this keeps the rail's own imports reading locally.
 */
export { computeDropIndex } from '@localixai/kit/list-reorder'
