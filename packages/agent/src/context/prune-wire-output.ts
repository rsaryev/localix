import type { Message, TextContent, ToolResult } from '../types'
import { textEncoderByteLength } from '../utils/hash'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, truncateTail } from '../utils/truncate'
import { crushNonRecoverable, CRUSH_MARKER } from './crushers'
import { carriesMarker, ELISION_MARKER } from './op-menu'
import { PAGED_READ_RESULT_TOOLS, READ_RESULT_TOOLS } from './tool-classes'

// Results are immutable snapshots: weak keys reuse bounds for the same object, while
// equal content in a new result is recomputed. Recovery availability has separate cache slots.
const boundToolResultCache = new WeakMap<
  ToolResult,
  { withRecovery?: ToolResult; withoutRecovery?: ToolResult }
>()

// The pointer prose — every variant of it, for BOTH compression layers — lives in
// `./pointers`. It is the model's only route back to content that just left the wire, and
// which recovery is CORRECT depends on the read's fate, so the words are owned in one
// place rather than re-typed per layer. See that module.

// Non-recoverable output (bash/command/test/build dumps, MCP, read errors) can't
// be re-read, so prune keeps it — but an OLD, very large one is bounded by a
// head+tail truncation rather than replayed in full every request. The start
// (what ran) AND the tail (where pass/fail + error summaries land) survive; only
// the verbose middle is dropped. Bounds the worst case on no-cache providers
// without losing the actionable signal.
const MIDDLE_TRUNCATE_HEAD = 2000
const MIDDLE_TRUNCATE_TAIL = 2000
export const MIDDLE_TRUNCATE_THRESHOLD = MIDDLE_TRUNCATE_HEAD + MIDDLE_TRUNCATE_TAIL + 500
/**
 * Sibling of {@link ELISION_MARKER}, same contract: emitted by INTERPOLATION below, read
 * back by `.includes()` to answer "is this content already compressed?". Exported because
 * the host asks that question too (its wire-dump highlights what the model is seeing as a
 * POINTER rather than as content) and was keeping a hand-copied list "in sync" by comment.
 */
export const MIDDLE_TRUNCATE_MARKER = '…middle truncated to save context'
// A STRUCTURAL crush is reversible (GP-2 `tool_output`), so it's safe to apply it
// to mid-size structured output too — not just the >4500-char giants that head+tail
// truncation targets. Below this, an output isn't worth bounding at all.
export const CRUSH_MIN_CHARS = 1000
/**
 * Has this model-facing text already been compressed by SOME layer — pointered, structurally
 * crushed, or middle-truncated?
 *
 * The three markers are one question, and callers should not have to know there are three
 * of them (nor that a new fourth layer would need adding to every OR chain). Two things
 * depend on the answer: the RATCHET (already-compressed content is never re-compressed,
 * which is what keeps the passes idempotent) and the INTACT-OR-NOT question a host asks
 * before telling the model "scroll up to that earlier read".
 *
 * NOT used for tool-call ARGS: a structural crush only ever runs on tool RESULTS, so
 * `collectElidedArgToolCallIds` deliberately checks the narrower pair. Widening it there
 * would be a behavior change, not a cleanup.
 */
export function isCompressedContent(text: string): boolean {
  return (
    carriesMarker(text, ELISION_MARKER) ||
    carriesMarker(text, MIDDLE_TRUNCATE_MARKER) ||
    carriesMarker(text, CRUSH_MARKER)
  )
}

/**
 * Reduce an ALREADY-compressed body to its leading pointer clause, dropping the excerpt.
 *
 * `prunedText` returns compressed text untouched, which is what makes elision monotone and the
 * prompt prefix stable. The cost is that the retained total can never shrink: each result keeps a
 * ~51 KiB excerpt from `boundToolResults`, so N recent results cost N x 51 KiB no matter what
 * `budgetTokens` says. Measured before this existed: 10 x 500 KB results came to 141_030 tokens
 * against a 120_000 budget, 20 came to 274_060, and tightening the budget to 40_000 changed
 * nothing — while the module documents that budget as "a hard ceiling".
 *
 * The excerpt is the only part that can go: the bracketed clause already names
 * `tool_output(action="get", tool_call_id=…)`, so dropping the body loses nothing unrecoverable. Applied
 * ONLY over budget — the excerpt is genuinely useful, and giving it up to fit is the same trade
 * the boundary quantum already collapses for.
 *
 * Idempotent: a pointer-only body is its own leading clause, so re-running never gives content
 * back and the ratchet stays monotone.
 */
export function pointerOnlyBody(text: string): string {
  if (!text.startsWith('[')) return text
  const close = text.indexOf(']')
  if (close < 0) return text
  const clause = text.slice(0, close + 1)
  return carriesMarker(clause, ELISION_MARKER) ||
    carriesMarker(clause, MIDDLE_TRUNCATE_MARKER) ||
    carriesMarker(clause, CRUSH_MARKER)
    ? clause
    : text
}

export function truncateMiddle(s: string, locator?: string, recoveryToolAvailable = true): string {
  const omitted = s.length - MIDDLE_TRUNCATE_HEAD - MIDDLE_TRUNCATE_TAIL
  // Like the structural crush, advertise that the FULL original is recoverable —
  // otherwise the model re-runs the command to see a dropped middle line.
  const recover =
    locator && recoveryToolAvailable
      ? `; full original via tool_output(action="get", tool_call_id="${locator}")`
      : ''
  return `${s.slice(0, MIDDLE_TRUNCATE_HEAD)}\n[${MIDDLE_TRUNCATE_MARKER} — ${omitted} chars omitted; start + end kept${recover}]\n${s.slice(-MIDDLE_TRUNCATE_TAIL)}`
}

/**
 * Bound every non-read string tool result before the recent-window policy runs.
 *
 * The ordinary wire policy deliberately protects the newest few messages, but a
 * single fresh tool result can itself be larger than the next model request. That
 * is especially easy for plugin/MCP tools, which do not necessarily share the
 * built-in tools' output limits. Pi caps tool output at 2,000 lines / 50 KiB and
 * Codex truncates function output as it enters history; enforce the same invariant
 * here on the wire copy. Read-class tools are deliberately excluded: their bounded
 * live-working-set policy is separate, and built-in readers already page/cap their
 * output. The durable item remains unchanged and the marker carries its
 * `tool_call_id`, so `tool_output` can recover the full value.
 *
 * The tail survives because exit status and diagnostics usually land there.
 */
function boundToolText(
  content: string,
  locator: string | undefined,
  keep: 'head' | 'tail',
  recoveryToolAvailable: boolean,
): string | undefined {
  if (isCompressedContent(content)) return undefined
  const truncate = keep === 'head' ? truncateHead : truncateTail
  let bounded = truncate(content, {
    // The marker is one model-facing line too. Reserve it up front so the
    // advertised 2,000-line limit is as hard as the byte limit.
    maxLines: DEFAULT_MAX_LINES - 1,
    maxBytes: DEFAULT_MAX_BYTES,
  })
  if (!bounded.truncated) return undefined

  const recover =
    locator && recoveryToolAvailable
      ? `; full original via tool_output(action="get", tool_call_id="${locator}")`
      : ''
  const makeMarker = () =>
    `[Tool output ${ELISION_MARKER} — showing ${keep === 'head' ? 'beginning' : 'end'}; ` +
    `${bounded.outputBytes}/${bounded.totalBytes} UTF-8 bytes, ` +
    `${bounded.outputLines}/${bounded.totalLines} lines${recover}]`
  let marker = makeMarker()
  // The notice is part of the wire too. Re-budget the kept tail around its exact
  // UTF-8 size so the advertised 50 KiB limit is a hard bound, not 50 KiB plus
  // an uncounted marker. Two passes normally converge; four also covers a digit-
  // width change in the reported byte/line counts.
  for (let i = 0; i < 4; i++) {
    const payloadBudget = Math.max(0, DEFAULT_MAX_BYTES - textEncoderByteLength(marker) - 1)
    const next = truncate(content, {
      maxLines: DEFAULT_MAX_LINES - 1,
      maxBytes: payloadBudget,
    })
    bounded = next
    const nextMarker = makeMarker()
    if (nextMarker === marker) break
    marker = nextMarker
  }
  if (!bounded.content) return marker
  return keep === 'head' ? `${bounded.content}\n${marker}` : `${marker}\n${bounded.content}`
}

function boundToolResult(r: ToolResult, recoveryToolAvailable: boolean): ToolResult {
  const cached = boundToolResultCache.get(r)
  const hit = recoveryToolAvailable ? cached?.withRecovery : cached?.withoutRecovery
  if (hit) return hit

  const isRead = READ_RESULT_TOOLS.has(r.toolName) && !r.isError
  const keep = isRead ? 'head' : 'tail'
  let result: ToolResult

  if (typeof r.content === 'string') {
    // Core readers already page and byte-cap at the source. Dynamically
    // registered app/plugin readers do not get that exemption: a contextClass
    // declaration describes recoverability, not an output-size guarantee.
    if (isRead && PAGED_READ_RESULT_TOOLS.has(r.toolName)) {
      result = r
    } else {
      const content = boundToolText(r.content, r.toolCallId, keep, recoveryToolAvailable)
      result = content === undefined ? r : { ...r, content }
    }
  } else {
    // A rich result can otherwise bypass the string cap with arbitrarily many
    // TextContent blocks. Share one text budget across the entire result, coalesce
    // bounded text, and preserve image/file parts. Media has its own preparation
    // and size policy.
    const text = r.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
    const boundedText = text
      ? boundToolText(text, r.toolCallId, keep, recoveryToolAvailable)
      : undefined
    result =
      boundedText === undefined
        ? r
        : {
            ...r,
            content: [
              { type: 'text', text: boundedText },
              ...r.content.filter((part) => part.type !== 'text'),
            ],
          }
  }

  const entry = cached ?? {}
  if (recoveryToolAvailable) entry.withRecovery = result
  else entry.withoutRecovery = result
  boundToolResultCache.set(r, entry)
  return result
}

export function boundToolResults(messages: Message[], recoveryToolAvailable: boolean): Message[] {
  let changed = false
  const out = messages.map((message) => {
    if (message.role !== 'tool') return message
    let messageChanged = false
    const results = message.results.map((result) => {
      const bounded = boundToolResult(result, recoveryToolAvailable)
      if (bounded !== result) messageChanged = true
      return bounded
    })
    if (!messageChanged) return message
    changed = true
    return { ...message, results }
  })
  return changed ? out : messages
}

// Bound an OLD non-recoverable output (≥ CRUSH_MIN_CHARS). Prefer a STRUCTURAL crush
// (JSON array / log) — it keeps far more signal per kept char and is reversible — when
// it shrinks the output meaningfully. Only the >4500-char giants additionally fall back
// to a blind head+tail truncation; a mid-size output with no usable structure is left
// as-is (returns `s` unchanged → caller treats it as untouched).
export function boundLargeOutput(
  s: string,
  locator: string | undefined,
  allowCrush: boolean,
  recoveryToolAvailable: boolean,
): string {
  const crushed = allowCrush ? crushNonRecoverable(s, { locator, recoveryToolAvailable }) : null
  if (crushed && crushed.text.length <= s.length * 0.7) return crushed.text
  if (s.length > MIDDLE_TRUNCATE_THRESHOLD) {
    const truncated = truncateMiddle(s, locator, recoveryToolAvailable)
    return crushed && crushed.text.length <= truncated.length ? crushed.text : truncated
  }
  return s
}

/** Rewrite only result text, retaining media order and unchanged object identities. */
export function createToolResultPruner(
  prunedText: (result: ToolResult, text: string) => string,
): (result: ToolResult) => ToolResult {
  return (r) => {
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
}
