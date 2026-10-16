/**
 * Per-REQUEST, wire-level context compression. The agent loop accumulates tool
 * results WITHIN a single turn (30 file reads → 30 tool messages), and every API
 * request in the loop re-sends the whole growing list — so a turn-start checkpoint
 * can't bound it. This runs inside `convertToLlm`, on every request, and elides
 * OLD recoverable tool I/O (read results + write/edit/patch args) beyond a recent
 * token window. Other large outputs retain bounded excerpts or structural summaries.
 * Idempotent: content already carrying a compression marker stays compressed.
 */
import type { Message, ToolCall, ToolResult } from '../types'
import { DEFAULT_LIVE_READ_BUDGET_BYTES } from './live-reads'
import { readPointer } from './pointers'
import { READ_RESULT_TOOLS } from './tool-classes'
import type { PruneWireOptions } from './prune-wire-options'
import { estimateWireMessageTokens } from './tokens'
import { createWireLiveReadAccessor, liveReadBudget, liveReadCount } from './prune-wire-live-reads'
import { protectWireTail } from './prune-wire-tail'
import { boundFreshMutationArgs } from './prune-wire-fresh-mutations'
import { elideToolCallArgs } from './prune-wire-args'
import {
  boundToolResults,
  createToolResultPruner,
  boundLargeOutput,
  isCompressedContent,
  pointerOnlyBody,
  MIDDLE_TRUNCATE_THRESHOLD,
  CRUSH_MIN_CHARS,
} from './prune-wire-output'

export { isCompressedContent, pointerOnlyBody, MIDDLE_TRUNCATE_MARKER } from './prune-wire-output'

export { collectElidedToolCallIds, collectElidedArgToolCallIds } from './prune-wire-markers'

export type { PruneWireOptions } from './prune-wire-options'

/**
 * The live-read budget's OWN default — independent of every other option. One large
 * file's worth of protected reads: the same number, and the same shape, as the
 * item-layer sibling `LiveReadOptions.budgetBytes` (`live-reads.ts`).
 *
 * A protection's budget must not be a FUNCTION of an unrelated knob that has a legal
 * zero, or the knob's zero silently switches the protection off. See
 * {@link PruneWireOptions.liveReadBudgetBytes}.
 */
export { DEFAULT_LIVE_READ_BUDGET_BYTES }

/**
 * Elide old recoverable tool I/O in a wire message list, protecting the recent
 * token window. Returns a new array; unchanged messages keep their reference.
 */
export function pruneWireMessages(
  inputMessages: Message[],
  opts: PruneWireOptions = {},
): Message[] {
  const estTokens = opts.estimateMessageTokens ?? estimateWireMessageTokens
  const recoveryToolAvailable = opts.recoveryToolAvailable !== false
  // This invariant precedes every gate and lock below: "recent" means valuable,
  // not unbounded. It also means a high pressure gate cannot accidentally exempt
  // the one fresh result that caused the pressure in the first place.
  const boundedResults = boundToolResults(inputMessages, recoveryToolAvailable)
  const cap = opts.keepRecentTokens ?? 16384
  const minKeep = opts.minKeepRecent ?? 4
  const minChars = opts.minElideChars ?? 400
  const maxLiveReads = liveReadCount(opts.maxLiveReads)
  const liveReadBudgetBytes = liveReadBudget(opts.liveReadBudgetBytes, cap)

  // Tool calls whose RESULT errored: their mutate args must stay verbatim (see
  // elideToolCallArgs). One pass over the whole list — results can trail their
  // call by several messages.
  const failedToolCallIds = new Set<string>()
  const successfulToolCallIds = new Set<string>()
  for (const m of boundedResults) {
    if (m.role !== 'tool') continue
    for (const r of m.results) {
      if (!r.toolCallId) continue
      if (r.isError) failedToolCallIds.add(r.toolCallId)
      else successfulToolCallIds.add(r.toolCallId)
    }
  }
  // Malformed/repaired histories can contain conflicting duplicate results. A
  // failure always wins: never discard the only unapplied mutation payload.
  for (const id of failedToolCallIds) successfulToolCallIds.delete(id)
  const messages = boundFreshMutationArgs(
    boundedResults,
    successfulToolCallIds,
    recoveryToolAvailable,
  )
  const N = messages.length

  const ratchet = opts.elidedToolCallIds
  const argRatchet = opts.elidedArgToolCallIds
  const hasRatchet = (ratchet?.size ?? 0) > 0 || (argRatchet?.size ?? 0) > 0

  const reads = createWireLiveReadAccessor({
    inputMessages,
    messages,
    minChars,
    maxLiveReads,
    liveReadBudgetBytes,
    recoveryToolAvailable,
  })

  /**
   * The pruned TEXT of one tool result, or `text` unchanged when nothing should change.
   * Split out from {@link pruneResult} so the SAME decisions apply whether the result
   * arrived as a bare string or as content parts.
   */
  // Set once `overBudget` is resolved below; `prunedText` closes over it.
  let overBudgetPruning = false
  const prunedText = (r: ToolResult, text: string): string => {
    // Over the hard ceiling the excerpt is the one thing left to take; see `pointerOnlyBody`.
    if (isCompressedContent(text)) return overBudgetPruning ? pointerOnlyBody(text) : text
    const ratcheted = r.toolCallId !== undefined && ratchet?.has(r.toolCallId) === true
    // Recoverable read output → a re-readable pointer (model can re-read the
    // file/source if it needs the bytes back). Errors are NOT pointered here
    // (re-reading won't reproduce them) — they fall through to the size-bound.
    if (READ_RESULT_TOOLS.has(r.toolName) && !r.isError && text.length > minChars) {
      // A read we already pointered stays pointered: the live-read protection exists to
      // keep the model's only copy of a file, and it lost that status the moment we
      // first elided it.
      if (!ratcheted && r.toolCallId && reads().live.has(r.toolCallId)) return text
      const fate = r.toolCallId ? reads().fates.get(r.toolCallId) : undefined
      return readPointer(fate ?? 'live', text.length, r.toolCallId, text, recoveryToolAvailable)
    }
    // Non-recoverable / error output: keep it (can't re-read), but bound an
    // OLD, very large one with a head+tail truncation.
    // Errored output is precious (the whole point is the failure detail), so it
    // is never structurally crushed — only the >4500-char giants get a head+tail
    // bound. Non-error output crushes from the lower CRUSH_MIN_CHARS threshold,
    // safely, since the original stays retrievable (GP-2 `tool_output`).
    const isErr = r.isError === true
    const threshold = isErr ? MIDDLE_TRUNCATE_THRESHOLD : CRUSH_MIN_CHARS
    if (text.length > threshold) {
      const bounded = boundLargeOutput(text, r.toolCallId, !isErr, recoveryToolAvailable)
      if (bounded !== text) return bounded
    }
    return text
  }

  const pruneResult = createToolResultPruner(prunedText)

  /**
   * Re-elide only the results the ratchet already claimed, leaving everything else alone.
   * This is what a "send it verbatim" decision means once elision is monotone: the two
   * early returns below say "no NEW compression is worth it", not "hand back what we took".
   */
  let ratchetChanged = false
  const ratchetMessage = (m: Message): Message => {
    if (m.role === 'tool' && ratchet?.size) {
      let mChanged = false
      const results = m.results.map((r) => {
        if (r.toolCallId === undefined || !ratchet.has(r.toolCallId)) return r
        const next = pruneResult(r)
        if (next !== r) mChanged = true
        return next
      })
      if (!mChanged) return m
      ratchetChanged = true
      return { ...m, results }
    }
    // The ARG half: a call whose heavy mutate args were already sent as pointers
    // stays pointered — same monotonicity, same reason (the tail stretching back
    // over it must not re-inflate the cached prefix).
    if (m.role === 'assistant' && argRatchet?.size) {
      let mChanged = false
      const content = m.content.map((part) => {
        const tc = part as ToolCall
        if (tc.type !== 'tool_call' || !argRatchet.has(tc.id)) return part
        const elided = elideToolCallArgs(tc, minChars, failedToolCallIds, recoveryToolAvailable)
        if (!elided) return part
        mChanged = true
        return elided
      })
      if (!mChanged) return m
      ratchetChanged = true
      return { ...m, content }
    }
    return m
  }
  const ratchetOnly = (): Message[] => {
    if (!hasRatchet) return messages
    ratchetChanged = false
    const out = messages.map(ratchetMessage)
    return ratchetChanged ? out : messages
  }

  // CONTEXT-PRESSURE GATE (before any work): while the whole request still fits
  // comfortably in the window, send it verbatim. Crushing here would only trade
  // cheap CACHED input tokens for uncached prefix churn plus a model round-trip to
  // recover what we took away. (0 disables.)
  //
  // …UNLESS the request does not fit at all. `budgetTokens` is a hard ceiling, and a
  // history above it must be crushed however comfortable the gate thinks it is. The two
  // thresholds are derived from DIFFERENT windows by design (pressure from the model's
  // raw window, the budget from the effective/capped one), so on any model whose raw
  // window exceeds the cap the gate sits far above the budget and, without this, the
  // whole layer is dormant in exactly the range where it is needed.
  const pressure = opts.pressureTokens ?? 0
  const budget = opts.budgetTokens ?? 0
  let overBudget = false
  if (pressure > 0 || budget > 0) {
    let total = opts.fixedOverheadTokens ?? 0
    for (let i = 0; i < N; i++) total += estTokens(messages[i], i)
    overBudget = budget > 0 && total > budget
    overBudgetPruning = overBudget
    if (!overBudget && pressure > 0 && total < pressure) return ratchetOnly()
  }

  const { locked, tailStart } = protectWireTail({
    messages,
    opts,
    estTokens,
    cap,
    minKeep,
    N,
    budget,
    overBudget,
  })

  // PRESSURE FLOOR: if the crushable (unlocked) region is small, crushing reclaims
  // little yet churns the cache prefix and hands the model recovery pointers it
  // doesn't need — the exact over-eager crushing that triggers re-read loops on
  // small/mid sessions. Below the floor, send the history untouched. (0 disables.)
  const minReclaim = opts.minReclaimTokens ?? 0
  if (minReclaim > 0 && !overBudget) {
    let unlockedTokens = 0
    for (let i = 0; i < N; i++) if (!locked[i]) unlockedTokens += estTokens(messages[i], i)
    if (unlockedTokens < minReclaim) return ratchetOnly()
  }

  const pruneUnlockedMessage = (m: Message): Message => {
    if (m.role === 'tool') {
      let mChanged = false
      const results = m.results.map((r) => {
        const next = pruneResult(r)
        if (next !== r) mChanged = true
        return next
      })
      if (!mChanged) return m
      return { ...m, results }
    }

    if (m.role === 'assistant') {
      let mChanged = false
      const content = m.content.map((part) => {
        if ((part as ToolCall).type !== 'tool_call') return part
        const elided = elideToolCallArgs(
          part as ToolCall,
          minChars,
          failedToolCallIds,
          recoveryToolAvailable,
        )
        if (!elided) return part
        mChanged = true
        return elided
      })
      if (!mChanged) return m
      return { ...m, content }
    }

    return m
  }

  let changed = false
  const out = messages.map((m, i) => {
    if (locked[i]) {
      // The tail is protected — EXCEPT for results this session already sent elided.
      // Handing those back intact would rewrite the cached prefix from here on.
      ratchetChanged = false
      const next = ratchetMessage(m)
      if (ratchetChanged) changed = true
      return next
    }

    const next = pruneUnlockedMessage(m)
    if (next !== m) changed = true
    return next
  })

  // The protected tail is only one part of the request: even when it fits `tailCap`, pointer
  // messages in the compressed prefix still cost tokens. If their residual cost leaves the
  // request over the hard ceiling, progressively release the OLDEST optional tail messages and
  // prune them too. The first message, the explicit count floor, and live-read protection remain
  // mandatory; exceeding the budget after those are exhausted is the documented irreducible case.
  if (overBudget && budget > 0) {
    let outputTokens = opts.fixedOverheadTokens ?? 0
    for (let i = 0; i < out.length; i++) outputTokens += estTokens(out[i], i)
    const mandatoryTailStart = Math.max(0, N - minKeep)
    for (let i = tailStart; outputTokens > budget && i < mandatoryTailStart; i++) {
      if (i === 0 || !locked[i]) continue
      const next = pruneUnlockedMessage(messages[i])
      if (next === messages[i]) continue
      outputTokens += estTokens(next, i) - estTokens(out[i], i)
      out[i] = next
      changed = true
    }
  }

  return changed ? out : messages
}
