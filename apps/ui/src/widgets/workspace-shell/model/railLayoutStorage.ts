import type { RailLayoutState, RailPlacement } from './railLayoutTypes'

/** Bumped when the persisted shape or generic placement rules change. */
export const RAIL_LAYOUT_VERSION = 6

/** localStorage key holding the serialized {@link RailLayoutState}. */
export const RAIL_LAYOUT_STORAGE_KEY = 'localix_rail_layout'

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
 * Invalid/duplicate ids are dropped; anything else → `null`.
 */
export function parseRailLayout(
  raw: string | null,
  restoreMiniAppPins = false,
): RailLayoutState | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const state = coerceRailLayout(data)
  const version =
    data && typeof data === 'object' && 'v' in data && typeof data.v === 'number' ? data.v : 0
  return state && restoreMiniAppPins && version < RAIL_LAYOUT_VERSION
    ? { ...state, legacyMiniAppPins: true }
    : state
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
