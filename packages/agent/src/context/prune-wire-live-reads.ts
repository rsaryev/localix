import type { Message, ToolCall, ToolResult } from '../types'
import { textEncoderByteLength } from '../utils/hash'
import {
  readFate,
  DEFAULT_LIVE_READ_BUDGET_BYTES,
  resolveLiveReadBudgetBytes,
  resolveMaxLiveReads,
  type ReadFate,
} from './live-reads'
import { inputFilePaths, normalizePathKey } from './path-key'
import { mutationInputPaths } from '../agents/mutation-paths'
import { ALL_MUTATE_TOOLS, READ_RESULT_TOOLS } from './tool-classes'

const liveReadByteLengthCache = new WeakMap<ToolResult, number>()

/**
 * The file a wire tool call observes or changes, as a normalized key. Wire calls
 * carry raw `arguments` (the item-level `targets.ts` resolver needs items), so this
 * is the same idea at the wire granularity: a `path`/`file_path` argument, the per-entry
 * paths of a batched `edit`/`write`, or the file headers of an `apply_patch` body.
 */
function wireTargets(name: string, args: unknown): string[] {
  if (!args || typeof args !== 'object') return []
  const a = args as Record<string, unknown>
  // `path`/`file_path`, every entry of a batched `edit` (`edits`) / `write` (`files`), and every
  // file of a batched read (`reads`).
  const named = [...mutationInputPaths(a), ...inputFilePaths(a)]
  if (named.length) return [...new Set(named.map(normalizePathKey))]
  const patch = a.patch
  if (typeof patch === 'string') {
    const out: string[] = []
    for (const m of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm))
      out.push(normalizePathKey(m[1].trim()))
    return out
  }
  return []
}

/**
 * `tool_call_id`s of read results that are the model's ONLY live copy of a file:
 * the last read of that path, with no later read that re-delivered its bytes and no
 * later mutation of it. Eliding those is what makes the agent either re-read the
 * file (a wasted turn) or — measured on the recorded corpus — patch it from memory
 * and fail with "context not found": of the reads the wire layer elided under a
 * failing patch, all but one were still the live copy.
 *
 * A superseded read stays elidable: its bytes are stale, and the newer observation
 * (or `apply_patch`'s post-edit echo) already carries the current state. A read whose
 * result is at or below `minChars` never supersedes — a few lines of the file cannot
 * stand in for the full copy the model is working from.
 *
 * Bounded: at most `maxLiveReads` of them, most recent first, and only while their
 * cumulative UTF-8 size fits `budgetBytes` — so a session that reads fifty files cannot
 * defeat pruning, and the live working set never outgrows the recent window.
 */
export function liveReadCallIds(
  messages: readonly Message[],
  minChars: number,
  maxLiveReads: number,
  budgetBytes: number,
  fates?: Map<string, ReadFate>,
): Set<string> {
  const resultContent = new Map<string, string>()
  const resultOk = new Map<string, boolean>()
  const resultObject = new Map<string, ToolResult>()
  for (const m of messages) {
    if (m.role !== 'tool') continue
    for (const r of m.results) {
      if (!r.toolCallId || typeof r.content !== 'string') continue
      resultContent.set(r.toolCallId, r.content)
      resultOk.set(r.toolCallId, r.isError !== true)
      resultObject.set(r.toolCallId, r)
    }
  }

  // Ordered scan of every tool call, so "superseded" means "a later observation of
  // the same key delivered bytes or changed the file".
  const reads: Array<{ id: string; keys: string[]; order: number; chars: number; bytes: number }> =
    []
  const supersededAfter = new Map<string, number>() // key → order of the last superseding call
  const mutatedAfter = new Map<string, number>() // key → order of the last call that CHANGED the file
  let order = 0
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    for (const part of m.content) {
      const tc = part as ToolCall
      if (tc.type !== 'tool_call') continue
      order += 1
      const keys = wireTargets(tc.name, tc.arguments)
      if (keys.length === 0) continue
      if (ALL_MUTATE_TOOLS.has(tc.name)) {
        // A mutation whose result ERRORED never reached disk — the earlier read is still
        // the live copy, and must not be marked stale ("the file has CHANGED") or lose
        // its live-read protection. Same rule as `failedToolCallIds` for mutate args.
        if (resultOk.get(tc.id) === false) continue
        for (const k of keys) {
          supersededAfter.set(k, order)
          mutatedAfter.set(k, order)
        }
      } else if (READ_RESULT_TOOLS.has(tc.name) && resultOk.get(tc.id) === true) {
        const content = resultContent.get(tc.id) ?? ''
        const chars = content.length
        const result = resultObject.get(tc.id)!
        let bytes = liveReadByteLengthCache.get(result)
        if (bytes === undefined) {
          bytes = textEncoderByteLength(content)
          liveReadByteLengthCache.set(result, bytes)
        }
        reads.push({ id: tc.id, keys, order, chars, bytes })
        if (chars > minChars) for (const k of keys) supersededAfter.set(k, order)
      }
    }
  }

  if (fates) for (const r of reads) fates.set(r.id, readFate(r, mutatedAfter, supersededAfter))

  const live = reads.filter((r) => {
    if (r.chars <= minChars || r.bytes > budgetBytes) return false
    return readFate(r, mutatedAfter, supersededAfter) === 'live'
  })
  live.sort((a, b) => b.order - a.order)

  const kept = new Set<string>()
  let spent = 0
  for (const r of live) {
    if (kept.size >= maxLiveReads) break
    if (spent + r.bytes > budgetBytes) continue
    spent += r.bytes
    kept.add(r.id)
  }
  return kept
}

type LiveReadMemo = {
  minChars: number
  maxLiveReads: number
  budgetBytes: number
  recoveryToolAvailable: boolean
  fates: Map<string, ReadFate>
  live: Set<string>
}
const liveReadMemoCache = new WeakMap<object, LiveReadMemo[]>()

interface LiveReadAccessorInput {
  inputMessages: Message[]
  messages: Message[]
  minChars: number
  maxLiveReads: number
  liveReadBudgetBytes: number
  recoveryToolAvailable: boolean
}

export function createWireLiveReadAccessor({
  inputMessages,
  messages,
  minChars,
  maxLiveReads,
  liveReadBudgetBytes,
  recoveryToolAvailable,
}: LiveReadAccessorInput): () => LiveReadMemo {
  // The last un-superseded read of each file is the model's only copy of it — protect a
  // bounded number of them wherever they sit in the history. `fates` also classifies the
  // reads we DO elide, so each gets the pointer that is actually true for it: replayable,
  // changed-on-disk, or already re-read below. Computed lazily: the early returns below are
  // the common case and must stay a scan-free identity.
  return () => {
    let entries = liveReadMemoCache.get(inputMessages)
    const cached = entries?.find(
      (entry) =>
        entry.minChars === minChars &&
        entry.maxLiveReads === maxLiveReads &&
        entry.budgetBytes === liveReadBudgetBytes &&
        entry.recoveryToolAvailable === recoveryToolAvailable,
    )
    if (cached) return cached

    const fates = new Map<string, ReadFate>()
    const live = liveReadCallIds(messages, minChars, maxLiveReads, liveReadBudgetBytes, fates)
    const memo = {
      minChars,
      maxLiveReads,
      budgetBytes: liveReadBudgetBytes,
      recoveryToolAvailable,
      fates,
      live,
    }
    entries ??= []
    entries.push(memo)
    liveReadMemoCache.set(inputMessages, entries)
    return memo
  }
}

/**
 * Resolve the live-read budget, FAILING CLOSED on every degenerate input.
 *
 * Only a positive finite number is a budget; absent / `0` / negative / `NaN` all mean
 * "no budget given" and get the safe default — never "protect nothing". `keepRecentTokens`
 * may still scale the default UP (one protected-tail's worth), but the floor means it can
 * never scale it to zero.
 */
export function liveReadBudget(budget: number | undefined, keepRecentTokens: number): number {
  const scaled = Number.isFinite(keepRecentTokens) ? keepRecentTokens * 4 : 0
  return resolveLiveReadBudgetBytes(budget, Math.max(scaled, DEFAULT_LIVE_READ_BUDGET_BYTES))
}

/**
 * Resolve the live-read COUNT. Unlike the budget, `0` is meaningful here: it is the
 * protection's one explicit, named off-switch. A negative or non-finite count is not a
 * switch though — it is a broken count (and `NaN` would silently unbound the count
 * entirely, since `kept.size >= NaN` is always false), so it falls back to the default.
 */
export function liveReadCount(max: number | undefined): number {
  return resolveMaxLiveReads(max)
}
