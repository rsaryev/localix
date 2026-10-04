/**
 * JSON-array crusher — structural compression for tool outputs that are a JSON
 * array of homogeneous objects (search hits, `ls`/list dumps, metric series, API
 * responses). The dominant redundancy in these is (a) fields that repeat the same
 * value on every row and (b) a long tail of near-identical rows.
 *
 * vs generic head/tail `truncate`: we hoist constant fields out ONCE and keep a
 * head+tail of rows PLUS the most anomalous middle rows (robust per-field z-score —
 * headroom's change-point technique, see selectRows), so a spike buried in the
 * middle of a metric series survives instead of being dropped as "similar". The
 * kept rows stay structurally intact and the model still sees the shared shape.
 * Pure + deterministic — measured by the bench harness and unit-tested here.
 * Returns `null` when the input isn't a crushable JSON array or when crushing
 * wouldn't shrink it (caller falls back to truncate).
 */

import type { CrushResult } from './types'

export type { CrushResult }

export interface CrushJsonOptions {
  /** Max rows to keep (head + tail). Default 15. */
  maxItems?: number
}

const stableKey = (v: unknown): string => JSON.stringify(v) ?? 'undefined'

/** Locate the array to crush: a top-level array, or the largest array-valued property of a wrapper object. */
function locateArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    let best: unknown[] | null = null
    for (const v of Object.values(parsed as Record<string, unknown>)) {
      if (Array.isArray(v) && (!best || v.length > best.length)) best = v
    }
    return best
  }
  return null
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Choose which rows to keep from a long array: a head, a tail, and the most
 * anomalous middle rows (max per-field z-score above ~2.5σ). Kept rows are emitted
 * in original order with `{__crushed: "… N rows omitted …"}` markers across gaps.
 */
function selectRows(rows: Record<string, unknown>[], maxItems: number): unknown[] {
  const n = rows.length
  const head = Math.ceil(maxItems * 0.4)
  const tail = Math.ceil(maxItems * 0.3)
  const anomalyBudget = Math.max(0, maxItems - head - tail)

  // Numeric fields present on most rows → per-field mean + std for z-scoring.
  const numericKeys = new Set<string>()
  for (const r of rows)
    for (const [k, v] of Object.entries(r))
      if (typeof v === 'number' && Number.isFinite(v)) numericKeys.add(k)
  const stats = new Map<string, { mean: number; std: number }>()
  for (const k of numericKeys) {
    const vals = rows
      .map((r) => r[k])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (vals.length < n * 0.6) continue // too sparse to trust
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length
    stats.set(k, { mean, std: Math.sqrt(variance) })
  }
  const zScore = (i: number): number => {
    let max = 0
    for (const [k, { mean, std }] of stats) {
      const v = rows[i][k]
      if (typeof v === 'number' && std > 0) max = Math.max(max, Math.abs(v - mean) / std)
    }
    return max
  }

  const keep = new Set<number>()
  for (let i = 0; i < head && i < n; i++) keep.add(i)
  for (let i = Math.max(0, n - tail); i < n; i++) keep.add(i)
  if (anomalyBudget > 0 && stats.size > 0) {
    // Score each candidate ONCE (zScore is O(stats) per call), then sort on the
    // cached value — avoids the O(n log n) recompute of filtering + comparator.
    const candidates = [...Array(n).keys()]
      .flatMap((i) => {
        if (keep.has(i)) return []
        const z = zScore(i)
        return z > 2.5 ? [{ i, z }] : []
      })
      .sort((a, b) => b.z - a.z)
      .slice(0, anomalyBudget)
    for (const { i } of candidates) keep.add(i)
  }

  const ordered = [...keep].sort((a, b) => a - b)
  const out: unknown[] = []
  let prev = -1
  for (const i of ordered) {
    if (i > prev + 1) out.push({ __crushed: `… ${i - prev - 1} rows omitted …` })
    out.push(rows[i])
    prev = i
  }
  if (prev < n - 1) out.push({ __crushed: `… ${n - 1 - prev} rows omitted …` })
  return out
}

export function crushJsonArray(text: string, opts: CrushJsonOptions = {}): CrushResult | null {
  const maxItems = opts.maxItems ?? 15
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const arr = locateArray(parsed)
  // Need a homogeneous array of objects with enough rows to be worth crushing.
  if (!arr || arr.length < 4 || !arr.every(isPlainObject)) return null
  const rows = arr as Record<string, unknown>[]

  // 1) Constant fields: keys present on every row with an identical value.
  const unionKeys = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r)) unionKeys.add(k)
  const constants: Record<string, unknown> = {}
  for (const k of unionKeys) {
    const first = rows[0][k]
    const allSame = rows.every((r) => k in r && stableKey(r[k]) === stableKey(first))
    if (allSame) constants[k] = first
  }
  const constantKeys = new Set(Object.keys(constants))

  // 2) Strip constant fields from each row.
  const trimmed = rows.map((r) => {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(r)) if (!constantKeys.has(k)) out[k] = r[k]
    return out
  })

  // 3) Cap rows: keep a head + tail PLUS statistical anomalies (rows whose numeric
  //    fields deviate sharply) — so a CPU/latency spike buried in the middle of a
  //    metric series survives instead of being dropped as "similar". (headroom's
  //    distinctive change-point technique; here a robust z-score over numeric fields.)
  let kept: unknown[]
  let keptRows: number
  if (trimmed.length > maxItems) {
    kept = selectRows(trimmed, maxItems)
    keptRows = kept.filter((r) => !(r as Record<string, unknown>).__crushed).length
  } else {
    kept = trimmed
    keptRows = trimmed.length
  }

  const payload: Record<string, unknown> = {}
  if (constantKeys.size) payload.__constants = constants
  payload.items = kept
  payload.__crushed_from = rows.length
  const out = JSON.stringify(payload)

  // Only worthwhile if it actually shrinks the text.
  if (out.length >= text.length) return null
  return {
    text: out,
    beforeChars: text.length,
    afterChars: out.length,
    keptItems: keptRows,
    totalItems: rows.length,
  }
}
