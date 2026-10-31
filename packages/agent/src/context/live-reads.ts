/**
 * Live reads: the `read` items whose result is the model's ONLY copy of a file.
 *
 * VBC assigns ONE operation per MESSAGE, and a persisted assistant message is a whole
 * agent run — often dozens of tool items. So a single `elide` op collapses every read
 * result and every mutate arg in that run at once, including the read of the file the
 * agent is about to patch. Measured on the recorded session corpus: of the reads that
 * were elided under an `apply_patch` which then failed with "context not found", the
 * overwhelming majority were still the live copy — the model then either re-read the
 * file (a wasted turn) or built the diff from memory (a wrong edit).
 *
 * A read is LIVE when no later observation replaced what it shows: no later `read` of
 * the same path re-delivered its bytes, and no later mutation changed the file. A
 * SUPERSEDED read stays fully compressible — its bytes are stale, and the newer read
 * (or `apply_patch`'s post-edit region echo) carries the current state.
 *
 * `prune-wire.ts` enforces the same rule one layer down, at wire granularity, where it
 * has raw tool-call arguments instead of items.
 */
import type { ChatMessage } from '../chat'
import { isFileChangeItem, isToolBackedItem, type ToolBackedItem } from '../agents/items'
import { textEncoderByteLength } from '../utils/hash'
import { itemResultModelText } from '../utils/prune-messages'
import { normalizePathKey } from './path-key'
import { defaultResolveTarget } from './targets'

export interface LiveReadOptions {
  /** How many live reads survive, most recent first. 0 disables. Default 6. */
  maxLiveReads?: number
  /** Total UTF-8 bytes of protected read results. Default 65536 (one large file). */
  budgetBytes?: number
  /**
   * A read result at or below this many chars delivers no bytes worth protecting (it is
   * never elided anyway) and too little of the file — a few lines, a listing, a notice —
   * to stand in for an earlier full read, so it never supersedes one. Default 400
   * (mirrors `PruneWireOptions.minElideChars`).
   */
  minChars?: number
}

/** Default live-read count shared by both context-compression layers. */
export const DEFAULT_MAX_LIVE_READS = 6

/** Default live-read UTF-8 byte budget shared by both context-compression layers. */
export const DEFAULT_LIVE_READ_BUDGET_BYTES = 65_536

/**
 * Resolve the protection's explicit off-switch. Only a finite, non-negative count
 * is meaningful; malformed values fail closed to the bounded default.
 */
export function resolveMaxLiveReads(value: number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value)
  }
  return DEFAULT_MAX_LIVE_READS
}

/**
 * Resolve a live-read budget. A budget is never an off-switch: non-positive or
 * non-finite values fail closed to the supplied safe fallback.
 */
export function resolveLiveReadBudgetBytes(
  value: number | undefined,
  fallback = DEFAULT_LIVE_READ_BUDGET_BYTES,
): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * How an elided read should be recovered:
 * - `live` — nothing touched it; `ToolOutput` replays its exact bytes.
 * - `stale` — the file CHANGED after this read; a replay would hand the model content
 *   that no longer exists on disk. Only a fresh read is correct.
 * - `refreshed` — the model re-read the same file later, so the current bytes are
 *   already further down the conversation.
 */
export type ReadFate = 'live' | 'stale' | 'refreshed'

/**
 * The fate of one read from what happened to its files afterwards. A batched read names several:
 * ONE changed file makes a replay wrong (`stale`), but it is `refreshed` only when EVERY file was
 * re-delivered later — until then it is still the only copy of the others.
 */
export function readFate(
  read: { keys: readonly string[]; order: number },
  mutatedAfter: ReadonlyMap<string, number>,
  supersededAfter: ReadonlyMap<string, number>,
): ReadFate {
  if (read.keys.some((k) => (mutatedAfter.get(k) ?? 0) > read.order)) return 'stale'
  if (read.keys.every((k) => (supersededAfter.get(k) ?? 0) > read.order)) return 'refreshed'
  return 'live'
}

export interface ReadClassification {
  /** The bounded set of reads that survive compression untouched. */
  live: Set<string>
  /** Fate of EVERY read item, including the live ones. */
  fates: Map<string, ReadFate>
}

/** `toolCallId`s of the live reads, bounded by count and total size. */
export function liveReadItemIds(
  messages: readonly ChatMessage[],
  opts: LiveReadOptions = {},
): Set<string> {
  return classifyReads(messages, opts).live
}

export function classifyReads(
  messages: readonly ChatMessage[],
  opts: LiveReadOptions = {},
): ReadClassification {
  const maxLiveReads = resolveMaxLiveReads(opts.maxLiveReads)
  const budgetBytes = resolveLiveReadBudgetBytes(opts.budgetBytes)
  const minChars = opts.minChars ?? 400

  type ReadRef = { id: string; keys: string[]; order: number; chars: number; bytes: number }
  const allReads: ReadRef[] = []
  const candidates: ReadRef[] = []
  const supersededAfter = new Map<string, number>()
  const mutatedAfter = new Map<string, number>()
  let order = 0

  for (const m of messages) {
    for (const item of m.items ?? []) {
      if (!isToolBackedItem(item)) continue
      order += 1
      const target = defaultResolveTarget(item as ToolBackedItem)
      if (!target || target.keys.length === 0) continue

      if (target.class === 'mutate') {
        // A FAILED mutation never reached disk: the earlier read is still the live copy,
        // and stamping it `stale` ("the file has CHANGED — do NOT replay") would be
        // factually false — forcing a fresh read in the retry-the-patch scenario this
        // module exists for. A partial apply_patch fails per file: only the paths that
        // actually applied mutate.
        if (item.status === 'failed') continue
        const failedPaths = isFileChangeItem(item)
          ? new Set(
              item.changes.flatMap((c) => (c.failed === true ? [normalizePathKey(c.path)] : [])),
            )
          : undefined
        for (const k of target.keys) {
          if (failedPaths?.has(k)) continue
          supersededAfter.set(k, order)
          mutatedAfter.set(k, order)
        }
        continue
      }
      if (target.class !== 'read') continue

      const resultText = itemResultModelText(item as ToolBackedItem)
      const chars = resultText.length
      const bytes = textEncoderByteLength(resultText)
      // Any read that re-delivered the file's bytes supersedes the earlier one; a
      // sub-minChars result (a few lines of it) does not, or a narrow follow-up read
      // would evict the full copy the model is working from.
      if (chars > minChars) for (const k of target.keys) supersededAfter.set(k, order)
      // Only `read` observes a whole file. `search`/`lsp` results describe many files
      // and are cheaply reproducible, so they stay ordinary compressible output.
      if (item.name !== 'Read' || item.status !== 'completed') continue
      const id = item.toolCallId
      if (!id) continue
      // Fate is classified for EVERY read (a huge one still needs the right pointer);
      // only reads inside the size bounds can win live-read protection.
      allReads.push({ id, keys: target.keys, order, chars, bytes })
      if (chars > minChars && bytes <= budgetBytes)
        candidates.push({ id, keys: target.keys, order, chars, bytes })
    }
  }

  const fates = new Map<string, ReadFate>()
  for (const c of allReads) {
    fates.set(c.id, readFate(c, mutatedAfter, supersededAfter))
  }

  const kept = new Set<string>()
  if (maxLiveReads > 0) {
    const live = candidates.filter((c) => fates.get(c.id) === 'live')
    live.sort((a, b) => b.order - a.order)
    let spent = 0
    for (const c of live) {
      if (kept.size >= maxLiveReads) break
      if (spent + c.bytes > budgetBytes) continue
      spent += c.bytes
      kept.add(c.id)
    }
  }
  return { live: kept, fates }
}
