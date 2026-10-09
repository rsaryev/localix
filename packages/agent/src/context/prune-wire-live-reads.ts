import type { Message, ToolCall, ToolResult } from '../types'
import { textEncoderByteLength } from '../utils/hash'
import type { ReadFate } from './live-reads'
import { normalizePathKey } from './path-key'
import { ALL_MUTATE_TOOLS, READ_RESULT_TOOLS } from './tool-classes'

const liveReadByteLengthCache = new WeakMap<ToolResult, number>()

/**
 * The file a wire tool call observes or changes, as a normalized key. Wire calls
 * carry raw `arguments` (the item-level `targets.ts` resolver needs items), so this
 * is the same idea at the wire granularity: a `path`/`file_path` argument, or the
 * file headers of an `apply_patch` body.
 */
function wireTargets(name: string, args: unknown): string[] {
  if (!args || typeof args !== 'object') return []
  const a = args as Record<string, unknown>
  for (const field of ['path', 'file_path'] as const) {
    const v = a[field]
    if (typeof v === 'string' && v.trim()) return [normalizePathKey(v)]
  }
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
 * result is BELOW `minChars` never supersedes — that is `read`'s "unchanged since your
 * earlier read" stub, which delivers no bytes of its own.
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

  if (fates) {
    for (const r of reads) {
      const mutated = r.keys.some((k) => (mutatedAfter.get(k) ?? 0) > r.order)
      const reread = r.keys.some((k) => (supersededAfter.get(k) ?? 0) > r.order)
      fates.set(r.id, mutated ? 'stale' : reread ? 'refreshed' : 'live')
    }
  }

  const live = reads.filter((r) => {
    if (r.chars <= minChars || r.bytes > budgetBytes) return false
    return r.keys.every((k) => (supersededAfter.get(k) ?? 0) <= r.order)
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
