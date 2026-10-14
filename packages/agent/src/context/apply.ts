/**
 * Apply a {@link CompressionPlan}'s operations to the messages (verbatim /
 * truncate / oneline / pointer / elide). Pairing-safe: it only rewrites
 * tool-result TEXT (`resultText`) and mutation input ARGS on terminal tool-backed
 * items — `toolCallId`, `name`, `status`, and `type` are untouched — by routing
 * through the shared {@link pruneMessages} pipeline operating on `message.items`.
 */
import type { ChatMessage } from '../chat'
import {
  isCommandItem,
  isToolBackedItem,
  type AgentItem,
  type TextItem,
  type ToolBackedItem,
} from '../agents/items'
import { pruneMessages, itemResultModelText, type PruneRule } from '../utils/prune-messages'
import { truncateMiddle } from '../utils/truncate-middle'
import type { CompressionPlan } from './plan'
import { crushNonRecoverable, CRUSH_MARKER } from './crushers'
import { carriesMarker, ELISION_MARKER } from './compression-markers'
import {
  FOLD_KEEP_CHARS,
  FOLD_MIN_CHARS,
  heavyMutateInputs,
  recoverableReadResult,
  type Operation,
} from './op-menu'
import { elidedPointer, foldedTextMarker, readPointer } from './pointers'
import { hintClause } from './vocab-hints'
import type { ReadFate } from './live-reads'

// Carries ELISION_MARKER by INTERPOLATION (never by re-typing the phrase) so later
// passes/layers skip it — see the marker's declaration in `compression-markers.ts` for why that is a
// contract and not a label. Used only when the item has no `toolCallId` to hand back —
// see {@link pointerPlaceholder}.
export const POINTER_PLACEHOLDER = `[Old tool output ${ELISION_MARKER}]`

/**
 * The lossy ops below (`truncate` / `oneline` / `pointer`) only ever reach
 * NON-RECOVERABLE items — `elideItem` claims every read result and mutation arg
 * first. A bash or search result cannot be re-read from disk: without a handle the
 * model's only recovery is to RE-RUN the command, which is what the corpus shows it
 * doing. `tool_output` replays the stored original for one turn instead, and the
 * bytes are non-recoverable precisely because nothing else can change them — so
 * unlike a read pointer, the replay can never be stale.
 */
function recoveryHint(item: ToolBackedItem, recoveryToolAvailable: boolean): string {
  return item.toolCallId && recoveryToolAvailable
    ? ` — recover via tool_output(action="get", tool_call_id="${item.toolCallId}")`
    : ''
}

/**
 * The `pointer` op drops a NON-RECOVERABLE output whole — no head, no tail, nothing of the
 * text survives on the wire. That is exactly where vocabulary hints earn their tokens: the
 * model cannot re-read this content from disk, so `tool_output` (or a re-run) is the
 * only route back, and the hints are the only evidence left about whether it is worth taking.
 */
function pointerPlaceholder(item: ToolBackedItem, recoveryToolAvailable: boolean): string {
  const id = item.toolCallId
  const hints = hintClause(itemResultModelText(item))
  if (!id) return hints ? `[Old tool output ${ELISION_MARKER}${hints}]` : POINTER_PLACEHOLDER
  if (!recoveryToolAvailable) {
    return `[Old tool output ${ELISION_MARKER}; full original is unavailable in this run — re-run the originating read-only call only if needed${hints}]`
  }
  return `[Old tool output ${ELISION_MARKER} — recover via tool_output(action="get", tool_call_id="${id}")${hints}]`
}

/** Replace an item's model-facing result text, keeping identity/structure verbatim.
 *  Command items also get their display `output` shrunk for consistency; the model
 *  only ever reads `resultText`. */
export function withItemResultText<T extends ToolBackedItem>(item: T, text: string): T {
  if (isCommandItem(item)) return { ...item, resultText: text, output: text }
  return { ...item, resultText: text }
}

/**
 * Elide an item's heavy RECOVERABLE content (write/edit/patch input, or read result)
 * to a pointer — re-readable from disk. Identity fields (toolCallId/status/type) are
 * kept verbatim, so tool_call/tool_result pairing is preserved. Non-recoverable items
 * (e.g. bash output) are left untouched here.
 */
function elideItem(
  item: ToolBackedItem,
  fate: ReadFate | undefined,
  recoveryToolAvailable: boolean,
): ToolBackedItem {
  // A crushed recoverable payload advertises a WORKING recovery handle — a
  // `tool_output(action="get", tool_call_id=…)` replay of exactly this result for one turn —
  // NOT a bare "re-read", which re-lands the whole file and re-bills it every turn
  // (the endless-review re-read loop). The full original is durable
  // in the message store; tool_output reconstructs it by id.
  //
  // The WORDS are the wire prune's words, from the shared owner (`./pointers`), because
  // both layers know exactly the same thing here: `heavyMutateInputs` already refused a
  // mutation that failed or is still pending, so the content reached disk — and NEITHER
  // layer knows whether a later write changed it since. This one emitter used to re-type
  // its own variant, so the model got different recovery advice depending on which layer
  // happened to fire. `elidedPointer` also drops the handle when there is no toolCallId to
  // hand back, instead of advertising `tool_call_id=""` — a pointer to a call that cannot
  // be found is worse than no pointer: it costs a turn before the model falls back.
  const heavies = heavyMutateInputs(item)
  if (heavies.length) {
    const input = { ...(item.input as Record<string, unknown>) }
    for (const heavy of heavies) {
      input[heavy.field] = elidedPointer(
        heavy.field,
        heavy.text.length,
        item.toolCallId,
        heavy.text,
        recoveryToolAvailable,
      )
    }
    return { ...item, input }
  }
  const read = recoverableReadResult(item)
  if (read) {
    // `tool_output` replays the ORIGINAL bytes. That is the right recovery only
    // while they still describe the file: once a later write changed it, a replay hands
    // the model content that no longer exists on disk, and once the model re-read the
    // file the current bytes are already further down the conversation.
    // Same three strings the per-request wire prune emits, from the same owner — a
    // divergence here would give the model contradictory recovery advice depending on
    // which layer happened to elide the read.
    return withItemResultText(
      item,
      readPointer(fate ?? 'live', read.length, item.toolCallId, read, recoveryToolAvailable),
    )
  }
  return item
}

function onelineSummary(item: ToolBackedItem, recoveryToolAvailable: boolean): string {
  // Keep the first AND last non-empty lines: for command output the tail usually
  // carries the verdict (test summary, exit error), the head the invocation echo.
  const text = itemResultModelText(item)
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const first = (lines[0] ?? '').slice(0, 100)
  const last = lines.length > 1 ? (lines[lines.length - 1] ?? '').slice(0, 100) : ''
  const head = last && last !== first ? `${first} … ${last}` : first
  return text.length > head.length
    ? `${head} [+${text.length - head.length} chars ${ELISION_MARKER}${recoveryHint(item, recoveryToolAvailable)}]`
    : head
}

function rewriteItem(
  item: ToolBackedItem,
  op: Operation,
  recoveryToolAvailable: boolean,
): ToolBackedItem {
  if (item.status !== 'completed') return item
  // Already-compressed output (any layer's marker) is never re-compressed —
  // keeps multi-pass application strictly idempotent instead of degenerately
  // squeezing placeholders into smaller placeholders.
  const existing = itemResultModelText(item)
  if (carriesMarker(existing, ELISION_MARKER) || carriesMarker(existing, CRUSH_MARKER)) return item
  let text: string
  switch (op.kind) {
    case 'truncate': {
      const full = itemResultModelText(item)
      const k = op.truncateChars ?? full.length
      if (full.length <= k) return item
      // Head+tail split (~40/60): in command output the most diagnostic content —
      // failure summaries, exit status — sits at the END, while the head anchors
      // what was run. Head-only truncation used to drop exactly the part that
      // explains a failure.
      const headLen = Math.floor(k * 0.4)
      const tailLen = k - headLen
      const headTail =
        `${full.slice(0, headLen)}\n` +
        `[… ${full.length - k} chars ${ELISION_MARKER}${recoveryHint(item, recoveryToolAvailable)} …]\n` +
        full.slice(full.length - tailLen)
      // Prefer a STRUCTURAL crush (JSON array / log) when it applies and comes out
      // no larger than the head+tail bound — same signal-preserving upgrade L1 makes,
      // so a budget-driven L2 truncate of bash output doesn't degrade to blind slicing.
      const crushed = crushNonRecoverable(full, {
        locator: item.toolCallId,
        recoveryToolAvailable,
      })
      text = crushed && crushed.text.length <= headTail.length ? crushed.text : headTail
      break
    }
    case 'oneline':
      text = onelineSummary(item, recoveryToolAvailable)
      break
    case 'pointer':
      text = pointerPlaceholder(item, recoveryToolAvailable)
      break
    // Not a lossy rewrite: `verbatim` keeps the item, `elide` is applied by the
    // caller's elide stage (elideItem), `fold` rewrites text items and hands its tool
    // items the op it stacks on — neither happens here.
    case 'verbatim':
    case 'elide':
    case 'fold':
      return item
  }
  return withItemResultText(item, text)
}

/**
 * Fold one assistant text item to its head and tail. The signature, when a provider attached
 * one, was bound to the WHOLE text, so it cannot survive the fold; dropping a signature from an
 * earlier turn is protocol-safe, replaying a mismatched one is not.
 */
function foldTextItem(item: TextItem, messageId: string, recallToolAvailable: boolean): TextItem {
  if (item.text.length < FOLD_MIN_CHARS || carriesMarker(item.text, ELISION_MARKER)) return item
  const folded: TextItem = {
    ...item,
    text: truncateMiddle(item.text, {
      maxChars: FOLD_KEEP_CHARS,
      marker: (omitted) => foldedTextMarker(omitted, messageId, recallToolAvailable),
    }),
  }
  delete folded.textSignature
  return folded
}

/** Apply the plan's per-message ops, returning a new array (unchanged messages keep their reference). */
export function applyPlan<T extends ChatMessage>(
  messages: T[],
  plan: CompressionPlan,
  options: { recoveryToolAvailable?: boolean; recallToolAvailable?: boolean } = {},
): T[] {
  const recoveryToolAvailable = options.recoveryToolAvailable !== false
  const recallToolAvailable = options.recallToolAvailable !== false
  const opByIndex = new Map(plan.assignment.map((a) => [a.index, a.op]))
  // Live reads were excluded from every menu's cost, so they must be excluded from
  // every rewrite too — otherwise the plan's token estimate and the wire disagree.
  const protectedIds = plan.protectedItemIds
  const readFates = plan.readFates
  // Lossy ops sit BELOW `elide` in the menu (their cost was computed on top of the
  // elide stage), so they elide recoverable parts first and lossy-rewrite only the
  // rest. elideItem returns non-recoverable items unchanged.
  const applyToolOp = (it: ToolBackedItem, toolOp: Operation): ToolBackedItem => {
    if (protectedIds?.has(it.toolCallId)) return it
    const fate = readFates?.get(it.toolCallId)
    const elided = elideItem(it, fate, recoveryToolAvailable)
    if (toolOp.kind === 'elide') return elided
    return elided !== it ? elided : rewriteItem(it, toolOp, recoveryToolAvailable)
  }
  const rule: PruneRule = {
    name: 'vbc-apply',
    apply(message, ctx) {
      const op = opByIndex.get(ctx.index)
      if (!op || op.kind === 'verbatim') return undefined
      const items = message.items
      if (!items || items.length === 0) return undefined
      const transform = (it: AgentItem): AgentItem => {
        if (isToolBackedItem(it)) {
          const toolOp = op.kind === 'fold' ? op.stackedOn : op
          return toolOp ? applyToolOp(it, toolOp) : it
        }
        return op.kind === 'fold' && it.type === 'text'
          ? foldTextItem(it, message.id, recallToolAvailable)
          : it
      }
      let changed = false
      const next = items.map((it) => {
        const r = transform(it)
        if (r !== it) changed = true
        return r
      })
      return changed ? { items: next } : undefined
    },
  }
  // The plan already encodes hard-keep as verbatim ops, so disable the pipeline's
  // own first/tail protection and let the per-index rule decide everything.
  return pruneMessages(messages, {
    rules: [rule],
    protectFirst: false,
    keepRecentFromIndex: messages.length,
  }).messages
}
