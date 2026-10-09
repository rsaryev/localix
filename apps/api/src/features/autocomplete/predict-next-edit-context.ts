/**
 * Next-edit-prediction CONTEXT BUILDER — the pure, injected core that turns the
 * resolved Context Fabric contributions and recent-edit events into a RANKED,
 * BUDGET-BOUNDED prompt payload. Lexical ranking keeps this cheap and index-free:
 * candidates are server-policy-approved provider output only, never a persistent
 * project index or implicit cross-file/LSP gathering.
 *
 * Everything here is PURE and unit-tested (no I/O, no clock): the service does the
 * provider resolution and feeds the results in.
 * Quality over quantity — we rank by relevance and drop the tail at a hard budget.
 */

import { extractIdentifiers, baseNameNoExt } from './predict-context-signals'
export {
  extractIdentifiers,
  symbolsNearCursor,
  identifiersForLspLookup,
  baseNameNoExt,
  parseImportBasenames,
  type CursorIdentifier,
} from './predict-context-signals'

/** One related-context window fed to the ranker. `recencyIndex` 0 = newest. */
export interface ContextWindowInput {
  filepath: string
  content: string
  source: 'related' | 'lsp' | 'provided'
  recencyIndex: number
  /**
   * LSP windows only: the LINE DISTANCE of the source identifier from the cursor
   * (0 = on the cursor line). A definition for a symbol under the caret is more
   * relevant than one several lines away. Absent for related/provided windows,
   * where proximity is undefined.
   */
  proximity?: number
  /**
   * The provider's own rank relative to its peers (a contribution's `priority` offset), so a
   * reference the user linked outranks a tab that merely happens to be open. Absent = 0.
   */
  boost?: number
}

/** A ranked window: the input plus its relevance `score` (higher = keep first). */
export interface RankedContextWindow extends ContextWindowInput {
  score: number
}

// Per-source base priority — caller-supplied domain context is authoritative, an LSP
// definition is a strong semantic hit, a related editor window is the weakest signal.
const SOURCE_BASE: Record<ContextWindowInput['source'], number> = {
  provided: 1000,
  lsp: 400,
  related: 100,
}
const SYMBOL_OVERLAP_WEIGHT = 12
const IMPORT_NEIGHBOUR_BOOST = 60
const RECENCY_WINDOW = 20 // recencyIndex beyond this adds no bonus
const PROXIMITY_WEIGHT = 4 // per line closer to the cursor (LSP windows)
const PROXIMITY_WINDOW = 40 // proximity beyond this adds no bonus

/**
 * Score + rank context windows by relevance with one cheap weighted score: source
 * tier + lexical symbol overlap with the cursor bag + an import-neighbour boost +
 * a recency bonus + (LSP windows) a cursor-PROXIMITY bonus. Deduped by filepath
 * (highest score wins), sorted highest-first. Pure — unit-tested.
 */
export function rankContextWindows(
  windows: ContextWindowInput[],
  querySymbols: Set<string>,
  importBasenames: Set<string>,
): RankedContextWindow[] {
  const byPath = new Map<string, RankedContextWindow>()
  for (const w of windows) {
    if (!w.content.trim()) continue
    let overlap = 0
    for (const id of extractIdentifiers(w.content)) if (querySymbols.has(id)) overlap++
    const importBoost = importBasenames.has(baseNameNoExt(w.filepath)) ? IMPORT_NEIGHBOUR_BOOST : 0
    const recency = Math.max(0, RECENCY_WINDOW - w.recencyIndex)
    const proximity =
      w.proximity === undefined ? 0 : Math.max(0, PROXIMITY_WINDOW - w.proximity) * PROXIMITY_WEIGHT
    const score =
      SOURCE_BASE[w.source] +
      overlap * SYMBOL_OVERLAP_WEIGHT +
      importBoost +
      recency +
      proximity +
      (w.boost ?? 0)
    const prev = byPath.get(w.filepath)
    if (!prev || score > prev.score) byPath.set(w.filepath, { ...w, score })
  }
  return [...byPath.values()].sort((a, b) => b.score - a.score)
}

/**
 * Pick the most cursor-RELEVANT excerpt of a context window that fits `maxChars`,
 * instead of blindly taking the head — so a long related/provided file contributes
 * the region around the symbols the developer is working on (better cross-file
 * targeting), not just its imports. Scores each line by query-symbol overlap, then
 * grows a whole-line window around the best-matching line until the budget is hit.
 * Falls back to the head when the content already fits, there is no query bag, or
 * no line matches. Pure — unit-tested.
 */
export function pickRelevantExcerpt(
  content: string,
  querySymbols: Set<string>,
  maxChars: number,
): string {
  if (content.length <= maxChars) return content
  if (querySymbols.size === 0) return content.slice(0, maxChars)
  const lines = content.split('\n')
  let bestLine = -1
  let bestScore = 0
  for (let i = 0; i < lines.length; i++) {
    let hits = 0
    for (const id of extractIdentifiers(lines[i])) if (querySymbols.has(id)) hits++
    if (hits > bestScore) {
      bestScore = hits
      bestLine = i
    }
  }
  if (bestLine === -1) return content.slice(0, maxChars) // nothing relevant → head
  // Grow a whole-line window around the best line, cheapest side first, under budget.
  let start = bestLine
  let end = bestLine
  let size = lines[bestLine].length
  for (;;) {
    const prevCost = start > 0 ? lines[start - 1].length + 1 : Infinity
    const nextCost = end < lines.length - 1 ? lines[end + 1].length + 1 : Infinity
    if (prevCost === Infinity && nextCost === Infinity) break
    if (prevCost <= nextCost) {
      if (size + prevCost > maxChars) break
      size += prevCost
      start--
    } else {
      if (size + nextCost > maxChars) break
      size += nextCost
      end++
    }
  }
  const body = lines.slice(start, end + 1).join('\n')
  // An ellipsis hint tells the model the excerpt is not the file head (kept within budget).
  const prefixed = start > 0 ? `…\n${body}` : body
  return prefixed.slice(0, maxChars)
}

/**
 * Greedily fill a character budget with the highest-ranked windows, dropping the
 * tail to preserve relevance. Each window is reduced to its most cursor-relevant
 * excerpt under the per-window cap (via
 * `pickRelevantExcerpt` when `querySymbols` is given — else head-clipped), which
 * keeps one giant neighbour from starving the rest. Admission stops at `budgetChars`
 * or `maxWindows`. Pure.
 */
export function packContextWindows(
  ranked: RankedContextWindow[],
  budgetChars: number,
  maxWindows: number,
  perWindowChars: number,
  querySymbols: Set<string> = new Set(),
): RankedContextWindow[] {
  const kept: RankedContextWindow[] = []
  let used = 0
  for (const w of ranked) {
    if (kept.length >= maxWindows) break
    const clipped = pickRelevantExcerpt(w.content, querySymbols, perWindowChars)
    const cost = clipped.length
    if (used + cost > budgetChars) continue // skip this one, a smaller lower-ranked one may still fit
    used += cost
    kept.push({ ...w, content: clipped })
  }
  return kept
}

/** A same-file recent edit (the "events" signal) — window lines + optional location. */
export interface EditEventInput {
  /**
   * The region BEFORE the edit. A before→after diff exposes the change instead of
   * only its resulting state. Optional/back-compat: absent ⇒ render `lines` as-is.
   */
  before?: string[]
  /** The region AFTER the edit (the resulting window). */
  lines: string[]
  /** 1-based inclusive line range in the current file, when the client provided it. */
  startLine?: number
  endLine?: number
}

const MAX_EVENT_COUNT = 6
const MAX_EVENT_CHARS = 2000
/** Lines of unchanged context shown on each side of a diff's changed span. */
const DIFF_CONTEXT_LINES = 1
/** Safety cap — diffing a pathologically large merged window falls back to plain text. */
const DIFF_MAX_LINES = 400

/**
 * A compact single-hunk unified diff of `before` → `after`, prefix/suffix-trimmed
 * (O(n) — an edit is one contiguous region, so common head/tail are context and the
 * middle is the change). Returns `null` when the two are identical or too large to
 * diff cheaply (caller falls back to the plain resulting window). Lines are prefixed
 * ` ` (context), `-` (removed), `+` (added). Pure — unit-tested.
 */
export function formatEditDiff(before: string[], after: string[]): string | null {
  if (before.length > DIFF_MAX_LINES || after.length > DIFF_MAX_LINES) return null
  // Common prefix.
  let p = 0
  while (p < before.length && p < after.length && before[p] === after[p]) p++
  // Common suffix (not crossing the prefix on either side).
  let s = 0
  while (
    s < before.length - p &&
    s < after.length - p &&
    before[before.length - 1 - s] === after[after.length - 1 - s]
  )
    s++
  const removed = before.slice(p, before.length - s)
  const added = after.slice(p, after.length - s)
  if (removed.length === 0 && added.length === 0) return null // identical
  const ctxStart = Math.max(0, p - DIFF_CONTEXT_LINES)
  const lines: string[] = []
  for (let i = ctxStart; i < p; i++) lines.push(` ${before[i]}`)
  for (const l of removed) lines.push(`-${l}`)
  for (const l of added) lines.push(`+${l}`)
  const suffixCtx = Math.min(s, DIFF_CONTEXT_LINES)
  for (let i = after.length - s; i < after.length - s + suffixCtx; i++) lines.push(` ${after[i]}`)
  return lines.join('\n')
}

/**
 * Format recent-edit history as a compact, LOCATED, chronological log. Input is
 * newest-first (as the client tracker returns it); keep the newest `MAX_EVENT_COUNT`,
 * then render oldest→newest so the model reads the sequence the developer performed.
 * Each event renders as a before→after DIFF when the client supplied `before`, else as
 * the resulting window for backward compatibility. The line range is shown when
 * known. Budget-capped. Pure.
 */
export function formatEditEvents(events: EditEventInput[]): string {
  const fresh = events.flatMap((e) => {
    const diff = e.before ? formatEditDiff(e.before, e.lines) : null
    const text = diff ?? e.lines.join('\n')
    if (!text.trim()) return []
    return [{ ...e, text, isDiff: diff !== null }]
  })
  const kept = fresh.slice(0, MAX_EVENT_COUNT).reverse() // newest-N, then chronological
  const blocks: string[] = []
  let used = 0
  for (let i = 0; i < kept.length; i++) {
    const e = kept[i]
    const where =
      e.startLine !== undefined && e.endLine !== undefined
        ? ` (lines ${e.startLine}-${e.endLine})`
        : ''
    const kindTag = e.isDiff ? ' diff' : ''
    const block = `--- edit ${i + 1}${where}${kindTag} ---\n${e.text}`
    if (used + block.length > MAX_EVENT_CHARS) break
    used += block.length
    blocks.push(block)
  }
  return blocks.join('\n')
}

/** Render a ranked window group as labeled `--- <path> ---` blocks, or '' when empty. */
export function renderWindowGroup(windows: RankedContextWindow[]): string {
  return windows.map((w) => `--- ${w.filepath} ---\n${w.content}`).join('\n\n')
}
