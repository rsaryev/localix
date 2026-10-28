import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import type { StorageReader, StorageWriter } from '@localixai/mini-app-sdk/ui/storage'
import { normalizeIndicatorId } from '../../backend/indicator-spec'
import { isHexColor } from '../../backend/chart-drawing'

/**
 * Indicator preferences — the persisted shape behind the chart's indicator state: each active id
 * wrapped in a record carrying its per-indicator overrides (hidden / color / fixed range /
 * pane height) plus one chart-wide `scaleMode`. Anything stored that does not fit is dropped.
 *
 * Presence in `items` IS activation; overrides live on the record so they survive a
 * `set`/`remove`+`add` round-trip only when the id survives it (an indicator the user
 * re-adds later starts clean — carrying a hidden flag back would look like a broken add).
 */

export interface IndicatorRange {
  min: number
  max: number
}

export interface IndicatorPrefRecord {
  /** Canonical indicator id (`ema:200`) — presence in the list means ACTIVE. */
  id: string
  /** Kept mounted but invisible (legend eye) — pane numbering must not shift. */
  hidden?: boolean
  /** Primary-series color override (hex). Secondary series keep their spec colors. */
  color?: string
  /** Fixed pane range override; absent = the spec's `defaultRange`, else autoscale. */
  range?: IndicatorRange
  /** Explicit "use autoscale" — set when the user/agent clears a `defaultRange`. */
  rangeAuto?: boolean
  /** Persisted pane height (px) from a separator drag. Overlays never carry one. */
  paneHeight?: number
}

export type ChartScaleMode = 'linear' | 'log' | 'percentage'

export interface IndicatorPrefsV2 {
  v: 2
  items: IndicatorPrefRecord[]
  /** The MAIN price scale's mode; indicator panes keep their own scales. */
  scaleMode?: ChartScaleMode
}

/**
 * Persisted PER TAB (`localix.trading.indicators:<tabId>`, keyed by
 * `tradingChartTabId(connectionId, symbol)` like drawings and chart type): the indicators a
 * trader reads on one market are their choice for THAT market, not forced onto every chart.
 * A chart with no tab id speaks the bare key.
 */
const PREFS_KEY = 'localix.trading.indicators'
const tabPrefsKey = (tabId: string) => `${PREFS_KEY}:${tabId}`

const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** Validate one stored record field-by-field; null when the id itself is unusable. */
function migrateRecord(raw: unknown): IndicatorPrefRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? normalizeIndicatorId(r.id) : null
  if (!id || id === 'volume') return null
  const out: IndicatorPrefRecord = { id }
  if (r.hidden === true) out.hidden = true
  // The chart's ONE color rule (chart-drawing.ts) — a stored color the tool would have
  // accepted must not be silently dropped here, and vice versa.
  if (typeof r.color === 'string' && isHexColor(r.color)) out.color = r.color
  const range = r.range as Record<string, unknown> | undefined
  if (
    range &&
    typeof range === 'object' &&
    isFiniteNumber(range.min) &&
    isFiniteNumber(range.max) &&
    range.min < range.max
  )
    out.range = { min: range.min, max: range.max }
  if (r.rangeAuto === true) out.rangeAuto = true
  if (isFiniteNumber(r.paneHeight) && r.paneHeight >= 30 && r.paneHeight <= 2000)
    out.paneHeight = Math.round(r.paneHeight)
  return out
}

/**
 * ANY stored value → a valid prefs object. Total — never throws, never returns a
 * malformed record; duplicate ids keep the FIRST record (canonicalization can fold two
 * old spellings into one id).
 */
export function migrateIndicatorPrefsV2(raw: unknown): IndicatorPrefsV2 {
  const items: IndicatorPrefRecord[] = []
  const seen = new Set<string>()
  const push = (candidate: unknown) => {
    const record = migrateRecord(candidate)
    if (record && !seen.has(record.id)) {
      seen.add(record.id)
      items.push(record)
    }
  }
  let scaleMode: ChartScaleMode | undefined
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    if (Array.isArray(o.items)) for (const entry of o.items) push(entry)
    if (o.scaleMode === 'linear' || o.scaleMode === 'log' || o.scaleMode === 'percentage')
      scaleMode = o.scaleMode
  }
  return { v: 2, items, ...(scaleMode ? { scaleMode } : {}) }
}

export function loadIndicatorPrefsV2(tabId?: string, storage?: StorageReader): IndicatorPrefsV2 {
  return migrateIndicatorPrefsV2(loadJSON<unknown>(tabId ? tabPrefsKey(tabId) : PREFS_KEY, storage))
}

export function saveIndicatorPrefsV2(
  prefs: IndicatorPrefsV2,
  tabId?: string,
  storage?: StorageWriter,
): void {
  saveJSON(tabId ? tabPrefsKey(tabId) : PREFS_KEY, prefs, storage)
}

/** The active-id set a record list implies — what `resolveIndicators` consumes. */
export function activeIds(items: readonly IndicatorPrefRecord[]): Set<string> {
  return new Set(items.map((r) => r.id))
}

/**
 * Apply one agent `set_indicators` command. Pure. Ids arrive in any accepted spelling
 * and land canonical; unparseable ones are dropped (the tool already fix-it'd them).
 * A `set` PRESERVES the overrides of every id that survives it — the agent restating
 * the active list must not silently reset the user's colors and ranges.
 */
export function applyIndicatorCommandV2(
  items: readonly IndicatorPrefRecord[],
  mode: 'set' | 'add' | 'remove' | 'clear',
  ids: readonly string[],
): IndicatorPrefRecord[] {
  if (mode === 'clear') return []
  const canonical = ids
    .map((id) => normalizeIndicatorId(id))
    .filter((id): id is string => id !== null && id !== 'volume')
  const byId = new Map(items.map((r) => [r.id, r]))
  if (mode === 'set') return canonical.map((id) => byId.get(id) ?? { id })
  if (mode === 'add') {
    const next = [...items]
    for (const id of canonical) if (!byId.has(id)) next.push({ id })
    return next
  }
  const drop = new Set(canonical)
  return items.filter((r) => !drop.has(r.id))
}

/** Toggle an id's presence, returning a NEW array (React needs a fresh reference). */
export function toggleIndicatorV2(
  items: readonly IndicatorPrefRecord[],
  id: string,
): IndicatorPrefRecord[] {
  return items.some((r) => r.id === id) ? items.filter((r) => r.id !== id) : [...items, { id }]
}

/**
 * Patch one indicator's overrides. Setting `range` clears `rangeAuto` and vice versa
 * (they are the two poles of one choice); `null` on a field removes the override.
 */
export function patchIndicatorPref(
  items: readonly IndicatorPrefRecord[],
  id: string,
  patch: {
    hidden?: boolean
    color?: string | null
    range?: IndicatorRange | null
    rangeAuto?: boolean
    paneHeight?: number
  },
): IndicatorPrefRecord[] {
  return items.map((r) => {
    if (r.id !== id) return r
    const next: IndicatorPrefRecord = { ...r }
    if (patch.hidden !== undefined) {
      if (patch.hidden) next.hidden = true
      else delete next.hidden
    }
    if (patch.color !== undefined) {
      if (patch.color === null) delete next.color
      else next.color = patch.color
    }
    if (patch.range !== undefined) {
      if (patch.range === null) delete next.range
      else if (patch.range.min < patch.range.max) {
        next.range = patch.range
        delete next.rangeAuto
      }
    }
    if (patch.rangeAuto !== undefined) {
      if (patch.rangeAuto) {
        next.rangeAuto = true
        delete next.range
      } else delete next.rangeAuto
    }
    if (patch.paneHeight !== undefined && patch.paneHeight >= 30)
      next.paneHeight = Math.round(patch.paneHeight)
    return next
  })
}

/**
 * Re-key overrides when a params edit changes the id (`rsi:14` → `rsi:21`): the record
 * keeps its place and overrides, only the id (and nothing else) changes. No-op when the
 * new id already exists (two records must never share an id).
 */
export function rekeyIndicatorPref(
  items: readonly IndicatorPrefRecord[],
  fromId: string,
  toId: string,
): IndicatorPrefRecord[] {
  if (fromId === toId || items.some((r) => r.id === toId)) return [...items]
  return items.map((r) => (r.id === fromId ? { ...r, id: toId } : r))
}
