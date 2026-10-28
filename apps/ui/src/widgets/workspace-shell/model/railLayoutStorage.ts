import type { RailLayoutState, RailPlacement } from './railLayoutTypes'

/** Bumped when the persisted shape or generic placement rules change; any other version is dropped. */
export const RAIL_LAYOUT_VERSION = 6

/** localStorage key holding the serialized {@link RailLayoutState}. */
export const RAIL_LAYOUT_STORAGE_KEY = 'localix_rail_layout'

/**
 * Parse a raw localStorage value into a {@link RailLayoutState}. NEVER throws — anything that is
 * not the current envelope `{ v, entries: [{ id, area }] }` yields `null` (fall back to defaults)
 * so a stale or corrupt entry can't break the workspace shell. Invalid and duplicate ids are
 * dropped.
 */
export function parseRailLayout(raw: string | null): RailLayoutState | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  if (obj.v !== RAIL_LAYOUT_VERSION || !Array.isArray(obj.entries)) return null
  const seen = new Set<string>()
  const entries: RailPlacement[] = []
  for (const e of obj.entries) {
    if (!e || typeof e !== 'object') continue
    const { id, area } = e as Record<string, unknown>
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
    seen.add(id)
    entries.push({
      id,
      area:
        area === 'top' || area === 'bottom' || area === 'status' || area === 'overflow'
          ? area
          : 'bar',
    })
  }
  return { entries }
}

/** Serialize for storage (adds the version envelope). */
export function serializeRailLayout(state: RailLayoutState): string {
  return JSON.stringify({ v: RAIL_LAYOUT_VERSION, entries: state.entries })
}
