/**
 * Per-REQUEST, wire-level context compression. The agent loop accumulates tool
 * results WITHIN a single turn (30 file reads → 30 tool messages), and every API
 * request in the loop re-sends the whole growing list — so a turn-start checkpoint
 * can't bound it. This runs inside `convertToLlm`, on every request, and elides
 * OLD recoverable tool I/O (read results + write/edit/patch args) beyond a recent
 * token window. Non-recoverable output stays intact unless one result exceeds the
 * global tool-output safety bound. Idempotent (skips content already carrying a
 * compression marker).
 */
import type { Message, TextContent, ToolCall, ToolResult } from '../types'
import { quantizeBoundaryStart } from './boundary'
import {
  DEFAULT_LIVE_READ_BUDGET_BYTES,
  resolveLiveReadBudgetBytes,
  resolveMaxLiveReads,
  type ReadFate,
} from './live-reads'
import { carriesMarker, ELISION_MARKER } from './op-menu'
import { elidedPointer, readPointer } from './pointers'
import { ALL_MUTATE_TOOLS, NONIDEMPOTENT_TOOLS, READ_RESULT_TOOLS } from './tool-classes'
import type { PruneWireOptions } from './prune-wire-options'
import { estimateWireMessageTokens } from './tokens'
import { liveReadCallIds } from './prune-wire-live-reads'
import { boundFreshMutationArgs } from './prune-wire-fresh-mutations'
import {
  boundToolResults,
  boundLargeOutput,
  truncateMiddle,
  isCompressedContent,
  pointerOnlyBody,
  MIDDLE_TRUNCATE_THRESHOLD,
  MIDDLE_TRUNCATE_MARKER,
  CRUSH_MIN_CHARS,
} from './prune-wire-output'

export { isCompressedContent, pointerOnlyBody, MIDDLE_TRUNCATE_MARKER } from './prune-wire-output'

export type { PruneWireOptions } from './prune-wire-options'

type LiveReadMemo = {
  minChars: number
  maxLiveReads: number
  budgetBytes: number
  recoveryToolAvailable: boolean
  fates: Map<string, ReadFate>
  live: Set<string>
}
const liveReadMemoCache = new WeakMap<object, LiveReadMemo[]>()
function elideToolCallArgs(
  tc: ToolCall,
  minChars: number,
  failedToolCallIds: ReadonlySet<string>,
  recoveryToolAvailable: boolean,
): ToolCall | undefined {
  // A FAILED mutation never reached disk, so its content/patch args are NOT
  // recoverable by re-reading — eliding them would lose the intended-but-
  // unapplied change irrecoverably (same rule as VBC's heavyMutateInputs).
  if (failedToolCallIds.has(tc.id)) return undefined
  const args = tc.arguments
  if (!args || typeof args !== 'object') return undefined
  const a = args as Record<string, unknown>

  // Non-recoverable tools (bash/terminal): a VERY large command arg is almost
  // always a heredoc writing a file (`cat > f <<EOF …EOF`). Unlike a `write`
  // call's content (a recoverable mutate arg, pointer-elided below), a bash
  // command isn't pointer-recoverable AND was never bounded at all — so the whole
  // body replayed every turn for the rest of the session. Head/tail bound it,
  // mirroring how the bash OUTPUT is bounded: the command head (what ran) + tail
  // (the closing EOF / trailing command) survive, the heredoc bulk is dropped.
  if (NONIDEMPOTENT_TOOLS.has(tc.name)) {
    const cmd = a.command
    if (
      typeof cmd === 'string' &&
      cmd.length > MIDDLE_TRUNCATE_THRESHOLD &&
      !carriesMarker(cmd, MIDDLE_TRUNCATE_MARKER)
    ) {
      return { ...tc, arguments: { ...a, command: truncateMiddle(cmd) } }
    }
    return undefined
  }

  if (!ALL_MUTATE_TOOLS.has(tc.name)) return undefined
  // Elide EVERY heavy recoverable field, not just the first hit — an `edit` call
  // can carry both old_string and new_string above the threshold.
  let next: Record<string, unknown> | undefined
  for (const field of ['content', 'patch', 'old_string', 'new_string'] as const) {
    const v = a[field]
    if (typeof v === 'string' && v.length > minChars && !carriesMarker(v, ELISION_MARKER)) {
      next = {
        ...(next ?? a),
        [field]: elidedPointer(field, v.length, tc.id, v, recoveryToolAvailable),
      }
    }
  }
  if (Array.isArray(a.edits)) {
    const json = JSON.stringify(a.edits)
    if (json.length > minChars && !carriesMarker(json, ELISION_MARKER)) {
      next = {
        ...(next ?? a),
        edits: elidedPointer('edits', json.length, tc.id, json, recoveryToolAvailable),
      }
    }
  }
  return next ? { ...tc, arguments: next } : undefined
}

/**
 * The `tool_call_id`s whose results are no longer intact on this wire — elided to a
 * pointer, structurally crushed, or middle-truncated. Pure; scans the FINAL wire, so
 * it sees both compression layers (turn-start VBC and this per-request prune).
 *
 * A host uses it to answer "does the model still have the full output of that call?"
 * — e.g. `read`'s unchanged-file stub ("scroll up to that read") is only truthful
 * while the earlier read is intact; once elided, a repeat read must return the file.
 */
export function collectElidedToolCallIds(messages: readonly Message[]): string[] {
  const out: string[] = []
  for (const m of messages) {
    if (m.role !== 'tool') continue
    for (const r of m.results) {
      if (!r.toolCallId) continue
      const compressed =
        typeof r.content === 'string'
          ? isCompressedContent(r.content)
          : r.content.some((part) => part.type === 'text' && isCompressedContent(part.text))
      if (compressed) out.push(r.toolCallId)
    }
  }
  return out
}

/**
 * The arg half of {@link collectElidedToolCallIds}: `tool_call_id`s of assistant
 * tool calls whose heavy mutate ARGUMENTS are no longer intact on this wire.
 */
export function collectElidedArgToolCallIds(messages: readonly Message[]): string[] {
  const out: string[] = []
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    for (const part of m.content) {
      const tc = part as ToolCall
      if (tc.type !== 'tool_call' || !tc.id || !tc.arguments || typeof tc.arguments !== 'object')
        continue
      const hasMarker = Object.values(tc.arguments as Record<string, unknown>).some(
        (v) =>
          typeof v === 'string' &&
          (carriesMarker(v, ELISION_MARKER) || carriesMarker(v, MIDDLE_TRUNCATE_MARKER)),
      )
      if (hasMarker) out.push(tc.id)
    }
  }
  return out
}

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
 * Resolve the live-read budget, FAILING CLOSED on every degenerate input.
 *
 * Only a positive finite number is a budget; absent / `0` / negative / `NaN` all mean
 * "no budget given" and get the safe default — never "protect nothing". `keepRecentTokens`
 * may still scale the default UP (one protected-tail's worth), but the floor means it can
 * never scale it to zero.
 */
function liveReadBudget(budget: number | undefined, keepRecentTokens: number): number {
  const scaled = Number.isFinite(keepRecentTokens) ? keepRecentTokens * 4 : 0
  return resolveLiveReadBudgetBytes(budget, Math.max(scaled, DEFAULT_LIVE_READ_BUDGET_BYTES))
}

/**
 * Resolve the live-read COUNT. Unlike the budget, `0` is meaningful here: it is the
 * protection's one explicit, named off-switch. A negative or non-finite count is not a
 * switch though — it is a broken count (and `NaN` would silently unbound the count
 * entirely, since `kept.size >= NaN` is always false), so it falls back to the default.
 */
function liveReadCount(max: number | undefined): number {
  return resolveMaxLiveReads(max)
}

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

  // The last un-superseded read of each file is the model's only copy of it — protect a
  // bounded number of them wherever they sit in the history. `fates` also classifies the
  // reads we DO elide, so each gets the pointer that is actually true for it: replayable,
  // changed-on-disk, or already re-read below. Computed lazily: the early returns below are
  // the common case and must stay a scan-free identity.
  const reads = () => {
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

  /**
   * The pruned form of one tool result, or `r` itself when nothing should change.
   *
   * BOTH content shapes are handled, and that is the whole point of this wrapper: the pi
   * codec builds `content` as an ARRAY for every in-loop result (`fromPiMessage` →
   * `fromPiParts`), so a `typeof content !== 'string'` bail-out left this entire layer
   * inert in production — measured, a 27-read history came back byte-identical — while the
   * string path kept passing its tests. `collectElidedToolCallIds` was already
   * shape-agnostic; only this half was not.
   */
  const pruneResult = (r: ToolResult): ToolResult => {
    if (typeof r.content === 'string') {
      const next = prunedText(r, r.content)
      return next === r.content ? r : { ...r, content: next }
    }
    if (!Array.isArray(r.content)) return r
    const parts = r.content
    const textAt = parts.flatMap((part, index) => (part.type === 'text' ? [index] : []))
    // No text to elide (an image- or file-only result): the pointer would describe
    // nothing and the bytes are not recoverable by re-reading.
    if (textAt.length === 0) return r
    const joined = textAt.map((index) => (parts[index] as TextContent).text).join('')
    const next = prunedText(r, joined)
    if (next === joined) return r
    // Collapse the text run into ONE part at the first text position and keep every
    // non-text part in order. Dropping an image/file part here would lose bytes no
    // `tool_output` pointer can bring back, so only text is ever rewritten.
    const first = textAt[0]!
    const absorbed = new Set(textAt.slice(1))
    return {
      ...r,
      content: parts.flatMap((part, index) =>
        index === first
          ? [{ ...(part as TextContent), text: next }]
          : absorbed.has(index)
            ? []
            : [part],
      ),
    }
  }

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

  // Lock the recent tail (token-capped, with a minimum count) + the first message.
  //
  // EMERGENCY TAIL SHRINK. `budgetTokens` is documented as a HARD ceiling — "a history above
  // it must be crushed however comfortable the gate thinks it is" — but the tail protection
  // silently outranked it: with a tail fatter than the budget, EVERY message was locked, so
  // eliding had nothing left to reclaim and the history went out verbatim. Measured at the
  // default `keepRecentTokens`: 14 393 tokens returned against a 3 598 budget, unchanged.
  //
  // So when the request does not fit, the tail cap shrinks to what the budget can actually
  // afford. It is a LAST RESORT, and deliberately bounded three ways:
  //   - it only ever applies `overBudget`, which is the case that is otherwise a guaranteed
  //     provider rejection — a smaller protected tail beats losing the whole turn;
  //   - `minKeep` still protects the newest messages BY COUNT, so the active turn survives
  //     no matter how small the budget is (a budget that cannot hold those is a model the
  //     turn cannot run on at all, which is `ActiveTurnTooLargeError`'s job to say);
  //   - the ratchet and the live-read exemptions are untouched: this changes which messages
  //     are eligible for elision, not what eliding does to them. Note `liveReadBudgetBytes`
  //     is still scaled from the ORIGINAL `cap`, not from the shrunken tail — the last
  //     un-superseded read stays protected wherever it sits, which is the whole point of
  //     that separate protection.
  // WHEN IT ARMS, measured with the real helpers rather than asserted: the tail is ~17% of the
  // budget at 128k-1M declared windows (a 200k model: 30 000 against 180 000), so it is dormant
  // there. It arms on every over-budget request BELOW roughly a 45k window, where
  // `keepRecentTokens`' 16 384 floor is a large share of the trigger (at 16 384 the tail cap
  // becomes 6 008 — the whole affordable request). An earlier version of this comment claimed
  // "dormant on the common path" without that qualifier; a review measured the small-window
  // case and it is not dormant there at all.
  //
  // TWO COSTS, both real, neither hidden: (1) the result may STILL exceed the budget — the
  // count floor plus live-read-protected content are not reclaimable, and at `budgetTokens: 1`
  // the measured output is 6 199 tokens; (2) over budget the boundary quantum collapses to 1
  // (below), so a shrinking tail moves the protected boundary on every request and churns the
  // prompt-cache prefix instead of holding a stable one. That trade only applies to a request
  // that would otherwise be rejected outright, and a prune asks the host for a context
  // checkpoint at the next run start, so the churn is bounded to one run's tool loop.
  const affordableTail = overBudget ? Math.max(0, budget - (opts.fixedOverheadTokens ?? 0)) : cap
  const tailCap = Math.min(cap, affordableTail)
  const locked = Array.from({ length: N }, () => false)
  if (N > 0) locked[0] = true
  let tail = 0
  let tailStart = N
  for (let i = N - 1; i >= 0; i--) {
    const within = N - 1 - i < minKeep
    const messageTokens = estTokens(messages[i], i)
    // Under the hard ceiling, the optional tail is a budget rather than the usual approximate
    // window. A large result that does not fit must stay eligible for pointering instead of
    // pushing the protected region over the ceiling by its whole size.
    if (!within && (overBudget ? tail + messageTokens > tailCap : tail > tailCap)) break
    locked[i] = true
    tailStart = i
    tail += messageTokens
  }
  // Quantize the boundary DOWN to a multiple of the quantum so consecutive
  // requests share an identical pruned prefix (prompt-cache friendly). Only
  // ever ADDS protected messages — never fewer than the un-quantized window.
  // Over budget that trade inverts: protecting extra messages for cache stability
  // cannot outrank fitting in the window, so the quantum collapses to 1.
  const quantum = overBudget ? 1 : opts.boundaryQuantum
  for (let i = quantizeBoundaryStart(tailStart, quantum); i < tailStart; i++) locked[i] = true

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
