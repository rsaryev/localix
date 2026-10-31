/**
 * VBC dependency graph (pure, no LLM). Two cheap signals per message:
 *
 * - `depScore(i)`  — how much later messages depend on message i, measured by
 *   entities introduced at i that REAPPEAR at j>i, decayed by the gap (j-i).
 *   Built from an inverted index entity→message-indices, so it's ~linear.
 * - `supersededScore(i)` — how redundant message i's tool OBSERVATIONS are because
 *   a later, successful observation/mutation of the same target exists. Only READ
 *   observations are eligible (we never collapse edit/mutate records or bash).
 *   Strength rises the more recent the superseding observation is.
 */
import type { ChatMessage } from '../chat'
import { isToolBackedItem } from '../agents/items'
import { extractEntities, entityKey } from './entities'
import { defaultResolveTarget } from './targets'

export interface DepGraph {
  depScore(i: number): number
  supersededScore(i: number): number
}

export interface DepGraphOptions {
  /** Index-gap at which decay weight halves. Default 8. */
  recencyHalfLife?: number
  /** Weight multiplier for high-precision (tool-target) entities. Default 2. */
  preciseEntityWeight?: number
}

interface Observation {
  msg: number
  cls: 'read' | 'mutate'
  ok: boolean
  keys: string[]
}

const halve = (gap: number, halfLife: number) => Math.pow(0.5, gap / halfLife)

export function buildDepGraph(messages: ChatMessage[], opts: DepGraphOptions = {}): DepGraph {
  const halfLife = opts.recencyHalfLife ?? 8
  const preciseW = opts.preciseEntityWeight ?? 2
  const N = messages.length

  // Inverted index entityKey → ascending occurrences.
  const inverted = new Map<string, Array<{ msg: number; weight: number }>>()

  for (let i = 0; i < N; i++) {
    const ents = extractEntities(messages[i])
    for (const e of ents) {
      const k = entityKey(e)
      const list = inverted.get(k)
      const occurrence = { msg: i, weight: e.precise ? preciseW : 1 }
      if (list) list.push(occurrence)
      else inverted.set(k, [occurrence])
    }
  }

  // For occurrences i0 < i1 < ...:
  //   score(ik) = decay(i{k+1}-ik) * (1 + score(i{k+1}))
  // This is exactly the former sum over every later occurrence, evaluated once
  // in reverse. A path repeated in every message is therefore O(N), not O(N²).
  const depCache = Array.from({ length: N }, () => 0)
  for (const occurrences of inverted.values()) {
    let futureContribution = 0
    for (let k = occurrences.length - 2; k >= 0; k--) {
      const current = occurrences[k]
      const next = occurrences[k + 1]
      futureContribution = halve(next.msg - current.msg, halfLife) * (1 + futureContribution)
      depCache[current.msg] += current.weight * futureContribution
    }
  }

  function depScore(i: number): number {
    return depCache[i] ?? 0
  }

  // Target observations for supersession.
  const observations: Observation[] = []
  for (let i = 0; i < N; i++) {
    for (const item of messages[i].items ?? []) {
      if (!isToolBackedItem(item)) continue
      const t = defaultResolveTarget(item)
      if (!t || (t.class !== 'read' && t.class !== 'mutate') || t.keys.length === 0) continue
      observations.push({ msg: i, cls: t.class, ok: item.status === 'completed', keys: t.keys })
    }
  }
  // Index successful later observations by key (with class) for supersession lookup.
  const okByKey = new Map<string, Array<{ msg: number; cls: 'read' | 'mutate' }>>()
  for (const o of observations) {
    if (!o.ok) continue
    for (const k of o.keys) {
      const list = okByKey.get(k)
      const entry = { msg: o.msg, cls: o.cls }
      if (list) list.push(entry)
      else okByKey.set(k, [entry])
    }
  }
  // Index observations by message once — supersededScore is called per message,
  // so scanning ALL observations inside it would be O(n²) over the history.
  const obsByMsg = new Map<number, Observation[]>()
  for (const o of observations) {
    const list = obsByMsg.get(o.msg)
    if (list) list.push(o)
    else obsByMsg.set(o.msg, [o])
  }

  const supCache = Array.from({ length: N }, () => -1)
  function supersededScore(i: number): number {
    if (supCache[i] >= 0) return supCache[i]
    let best = 0
    for (const o of obsByMsg.get(i) ?? []) {
      // A READ is superseded by any later successful observation of the same key
      // (re-read or mutate). A MUTATE (write/edit) is superseded only by a later
      // successful MUTATE of the same key — the file content was overwritten.
      // A read of SEVERAL files (a batched `read`) is only as superseded as its least
      // superseded file: until every one was observed again, it holds the only copy of some.
      let readFloor = Number.POSITIVE_INFINITY
      for (const k of o.keys) {
        const occ = okByKey.get(k)
        if (!occ) {
          readFloor = 0
          continue
        }
        let keyBest = 0
        // okByKey lists are ascending by msg, and strength rises monotonically with
        // e.msg (a later superseding observation = smaller gap = higher strength). So
        // the LAST qualifying entry is the strongest: scan from the end and stop at
        // the first match instead of scanning the whole (possibly long) per-key list
        // — a hot file read/edited K times no longer costs O(K) per observer.
        for (let idx = occ.length - 1; idx >= 0; idx--) {
          const e = occ[idx]
          if (e.msg <= i) break // ascending list → everything earlier is also <= i
          if (o.cls === 'mutate' && e.cls !== 'mutate') continue
          const strength = halve(Math.max(0, N - 1 - e.msg), halfLife)
          if (strength > keyBest) keyBest = strength
          break // first qualifying-from-the-end is the max for this key
        }
        if (o.cls === 'mutate') best = Math.max(best, keyBest)
        else readFloor = Math.min(readFloor, keyBest)
      }
      if (o.cls === 'read' && Number.isFinite(readFloor)) best = Math.max(best, readFloor)
    }
    supCache[i] = best
    return best
  }

  return { depScore, supersededScore }
}
