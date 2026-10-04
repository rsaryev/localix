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
 *    (a freshly installed plugin panel) are appended to their DEFAULT area in def
 *    order — so the rail degrades gracefully as the available set changes.
 */

export type RailArea = 'top' | 'bar' | 'bottom' | 'status' | 'overflow'
export type PinnedRailArea = Exclude<RailArea, 'overflow'>

/** An entry available to the rail, with the area it defaults to when uncustomized. */
export interface RailItemDef {
  id: string
  defaultArea: RailArea
  /**
   * `false` for an entry that has NO rail placement and can never gain one — a
   * plugin view. Such an entry always resolves to `overflow`, even if an older
   * saved layout placed it somewhere visible, so a layout written back when plugin
   * views were still pinnable cannot strand an icon in a zone with no affordance
   * left to remove it. Defaults to placeable.
   */
  placeable?: boolean
}

/** One entry's placement in the saved layout. */
export interface RailPlacement {
  id: string
  area: RailArea
}

export interface RailLayoutState {
  entries: RailPlacement[]
}

/** Bumped when the persisted shape or generic placement rules change. */
export const RAIL_LAYOUT_VERSION = 5

/** localStorage key holding the serialized {@link RailLayoutState}. */
export const RAIL_LAYOUT_STORAGE_KEY = 'localix_rail_layout'

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
  const { bar } = resolveRailAreas(defs, state)
  const from = bar.indexOf(id)
  if (from < 0) return state ?? emptyRailLayout()
  const to = Math.max(0, Math.min(from + delta, bar.length - 1))
  // `moveRailItem` measures the index in the list AFTER removal; for a
  // within-list move the clamped absolute position maps to it directly.
  return moveRailItem(defs, state, id, 'bar', to)
}

/** Nudge an entry within either visible rail area. */
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

/**
 * Parse a raw localStorage value into a {@link RailLayoutState}, migrating older
 * or foreign shapes gracefully. NEVER throws — a malformed value yields `null`
 * (fall back to defaults) so a corrupt entry can't break the workspace shell.
 *
 * Accepted shapes:
 *  - versioned envelope: `{ v, entries: [{ id, area }] }`
 *  - legacy order-only array: `["viewlet:stats", …]` → all pinned to the bar
 *  - legacy `{ order?: string[], hidden?: string[] }` → order→bar, hidden→overflow
 *  - legacy `{ bar?: string[], overflow?: string[] }` → mapped directly
 * Unknown/duplicate ids are dropped; anything else → `null`.
 */
export function parseRailLayout(raw: string | null): RailLayoutState | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  return coerceRailLayout(data)
}

function coerceRailLayout(data: unknown): RailLayoutState | null {
  // Legacy order-only array.
  if (Array.isArray(data)) {
    return migrateRailLayout(
      dedupe(
        data.flatMap((id): RailPlacement[] => (isNonEmptyString(id) ? [{ id, area: 'bar' }] : [])),
      ),
      0,
    )
  }
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>

  // Versioned shape (or any object carrying an `entries` list of {id,area}).
  if (Array.isArray(obj.entries)) {
    const entries: RailPlacement[] = []
    for (const e of obj.entries) {
      if (!e || typeof e !== 'object') continue
      const { id, area } = e as Record<string, unknown>
      if (!isNonEmptyString(id)) continue
      entries.push({
        id,
        area:
          area === 'top' || area === 'bottom' || area === 'status' || area === 'overflow'
            ? area
            : 'bar',
      })
    }
    return migrateRailLayout(dedupe(entries), typeof obj.v === 'number' ? obj.v : 0)
  }

  // Legacy split shapes.
  const barKey = Array.isArray(obj.bar) ? obj.bar : Array.isArray(obj.order) ? obj.order : null
  const overflowKey = Array.isArray(obj.overflow)
    ? obj.overflow
    : Array.isArray(obj.hidden)
      ? obj.hidden
      : null
  if (barKey || overflowKey) {
    const entries: RailPlacement[] = [
      ...(barKey ?? []).flatMap((id): RailPlacement[] =>
        isNonEmptyString(id) ? [{ id, area: 'bar' }] : [],
      ),
      ...(overflowKey ?? []).flatMap((id): RailPlacement[] =>
        isNonEmptyString(id) ? [{ id, area: 'overflow' }] : [],
      ),
    ]
    return migrateRailLayout(dedupe(entries), 0)
  }
  return null
}

/**
 * v4 added the lower rail. v5 adds top + status placements and moves the
 * newly-customizable reset/keep-awake utilities to the horizontal status bar.
 */
function migrateRailLayout(state: RailLayoutState, fromVersion: number): RailLayoutState {
  return {
    entries: state.entries.map((entry) => {
      if (
        fromVersion < 5 &&
        (entry.id === 'reset-layout' ||
          entry.id === 'keep-awake' ||
          entry.id === 'utility:reset' ||
          entry.id === 'utility:keep-awake')
      ) {
        return { ...entry, area: 'status' }
      }
      return entry
    }),
  }
}

/** Serialize for storage (adds the version envelope). */
export function serializeRailLayout(state: RailLayoutState): string {
  return JSON.stringify({ v: RAIL_LAYOUT_VERSION, entries: state.entries })
}

function dedupe(entries: RailPlacement[]): RailLayoutState {
  const seen = new Set<string>()
  const out: RailPlacement[] = []
  for (const e of entries) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    out.push(e)
  }
  return { entries: out }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}
