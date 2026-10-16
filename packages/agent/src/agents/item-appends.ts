/**
 * String-suffix item deltas for the streaming wire.
 *
 * Between two item-list snapshots of the SAME assistant message, most ticks
 * differ only by monotonic string growth: a command's streamed `output`, a tool
 * call's arguments being typed (`input.content` of a `write`, `input.patch` of
 * an `apply_patch`), a generic tool's streamed `output.content`. Re-shipping the
 * whole cumulative message for those ticks is the classic ~100× egress/CPU
 * amplification; this module detects that case and expresses it as tiny appends.
 *
 * Producer (`diffItemsForAppends`) and consumer (`applyItemAppend`) live in one
 * module so the wire contract cannot drift between the API and its clients.
 * The diff is deliberately conservative: ANY change it cannot prove to be pure
 * string-suffix growth returns `null`, and the caller falls back to a full
 * `message.updated` snapshot — which is also the periodic resync point, so a
 * missed append can never corrupt state, only cost one bigger event.
 */
import { isToolBackedItem } from './item-model'
import type { AgentItem } from './item-model'

/** One string-suffix growth on one item, addressed structurally (no JSON paths). */
export interface AgentItemAppend {
  itemId: string
  /**
   * `text` with no `key` = a secondary narrative item's own text.
   * `output` with no `key` = the item's own string `output` (command items).
   * `output` + `key` = a string field inside the item's `output` record
   * (generic tool_call items streaming e.g. `{ content }`).
   * `input` + `key` = a string field inside the item's `input` record
   * (progressive tool-arg streaming).
   */
  slot: 'text' | 'input' | 'output'
  key?: string
  append: string
}

/** Past this, the tick is structural in all but name — ship the snapshot. */
const MAX_APPENDS_PER_DELTA = 8

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Whether two narrative items carry the same metadata. Fields are compared by identity first —
 * an unchanged field is usually the same value — and only a field that differs by reference is
 * serialized, so a streaming tick does not stringify every item's metadata.
 */
function sameMeta(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) {
    if (!(key in b)) return false
    const av = a[key]
    const bv = b[key]
    if (av === bv) continue
    if (typeof av !== 'object' || typeof bv !== 'object' || av === null || bv === null) return false
    if (JSON.stringify(av) !== JSON.stringify(bv)) return false
  }
  return true
}

/**
 * Fold the growth between two records into appends. Every difference must be a
 * string that grew by suffix (or a string key that newly appeared — streamed
 * JSON args materialize keys as the parser reaches them); anything else is
 * structural. A key that VANISHED is structural too.
 */
function recordAppends(
  itemId: string,
  slot: 'input' | 'output',
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  out: AgentItemAppend[],
): boolean {
  for (const key of Object.keys(prev)) {
    if (!(key in next)) return false
  }
  for (const key of Object.keys(next)) {
    const a = prev[key]
    const b = next[key]
    if (a === b) continue
    if (typeof b !== 'string') return false
    if (a === undefined) {
      out.push({ itemId, slot, key, append: b })
      continue
    }
    if (typeof a !== 'string' || b.length <= a.length || !b.startsWith(a)) return false
    out.push({ itemId, slot, key, append: b.slice(a.length) })
  }
  return true
}

/** The growth between two versions of ONE tool-backed item, or `false` if structural. */
function itemPairAppends(a: AgentItem, b: AgentItem, out: AgentItemAppend[]): boolean {
  if (a.status !== b.status) return false
  const rawA = a as unknown as Record<string, unknown>
  const rawB = b as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(rawA), ...Object.keys(rawB)])
  for (const k of keys) {
    const av = rawA[k]
    const bv = rawB[k]
    if (av === bv) continue
    if (k === 'output' && (av === undefined || typeof av === 'string')) {
      if (typeof bv !== 'string') return false
      const base = av ?? ''
      if (bv.length <= base.length || !bv.startsWith(base)) return false
      out.push({ itemId: b.id, slot: 'output', append: bv.slice(base.length) })
      continue
    }
    if (k === 'output' || k === 'input') {
      const aRec = av === undefined ? {} : av
      if (!isRecord(aRec) || !isRecord(bv)) return false
      if (!recordAppends(b.id, k, aRec, bv, out)) return false
      continue
    }
    return false
  }
  return true
}

/**
 * Diff two item-list snapshots into pure string-suffix appends.
 *
 * Returns `[]` when nothing changed, the appends when every change is provable
 * suffix growth, and `null` when anything structural happened (item added or
 * removed, reordered, status moved, a non-string field changed) — the caller
 * must then ship a full snapshot.
 *
 * `passthroughTextItemIds` are the CURRENT turn's text/reasoning item ids: their
 * growth rides the delta's dedicated `textAppend`/`reasoningAppend` fields, so a
 * change to them is expected and carried elsewhere, not structural.
 */
export function diffItemsForAppends(
  prev: AgentItem[] | undefined,
  next: AgentItem[] | undefined,
  passthroughTextItemIds: ReadonlySet<string>,
): AgentItemAppend[] | null {
  if (prev === next) return []
  if (!prev || !next || prev.length !== next.length) return null
  const out: AgentItemAppend[] = []
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i]
    const b = next[i]
    if (a === b) continue
    if (a.id !== b.id || a.type !== b.type) return null
    if ((b.type === 'text' || b.type === 'reasoning') && passthroughTextItemIds.has(b.id)) {
      continue
    }
    if ((a.type === 'text' || a.type === 'reasoning') && b.type === a.type) {
      const { text: oldText, ...oldMeta } = a
      const { text: newText, ...newMeta } = b
      if (!sameMeta(oldMeta, newMeta) || !newText.startsWith(oldText)) return null
      if (newText.length > oldText.length) {
        out.push({ itemId: b.id, slot: 'text', append: newText.slice(oldText.length) })
      }
      continue
    }
    if (!isToolBackedItem(a) || !isToolBackedItem(b)) return null
    if (!itemPairAppends(a, b, out)) return null
    if (out.length > MAX_APPENDS_PER_DELTA) return null
  }
  return out
}

/**
 * Apply one append to one item, returning the grown copy — or `null` when the
 * item's live shape doesn't match the append (client state drifted); the caller
 * keeps the item unchanged and the next full snapshot resyncs it.
 */
export function applyItemAppend(item: AgentItem, ap: AgentItemAppend): AgentItem | null {
  if (ap.slot === 'text' && ap.key === undefined) {
    if (item.type !== 'text' && item.type !== 'reasoning') return null
    return { ...item, text: item.text + ap.append }
  }
  if (ap.slot === 'output' && ap.key === undefined) {
    const out = (item as { output?: unknown }).output
    if (out !== undefined && typeof out !== 'string') return null
    return { ...item, output: (out ?? '') + ap.append } as AgentItem
  }
  if (ap.key === undefined) return null
  const slotVal = (item as unknown as Record<string, unknown>)[ap.slot]
  const rec = slotVal === undefined ? {} : slotVal
  if (!isRecord(rec)) return null
  const cur = rec[ap.key]
  if (cur !== undefined && typeof cur !== 'string') return null
  return {
    ...item,
    [ap.slot]: { ...rec, [ap.key]: (cur ?? '') + ap.append },
  } as AgentItem
}
