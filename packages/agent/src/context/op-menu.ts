/**
 * The per-message operation menu for VBC.
 *
 * The dominant token cost in agent conversations is heavy, RECOVERABLE tool I/O:
 * the file content a `write`/`edit`/`apply_patch` sends (in the tool-call args) and
 * the file content a `read`/`search`/`lsp` returns (in the tool result). All of it
 * is recoverable from disk by re-reading, so beyond the recent window it can be
 * collapsed to a pointer near-losslessly — the `elide` op, marked `lossless` so the
 * allocator applies it regardless of budget.
 *
 * Non-recoverable results (e.g. `bash` output — can't be safely re-run) get the
 * lossy downgrade chain (truncate → oneline → pointer) and are only compressed when
 * the token budget forces it. Messages with no compressible tool I/O are `[verbatim]`.
 *
 * Operates on tool-backed `AgentItem`s (the single source of truth). The model-token
 * cost of an item is its `input` JSON + model-facing `resultText`; rich display-only
 * fields (command `output`, file_change `diff`) never re-enter the prompt.
 */
import type { ChatMessage } from '../chat'
import { isFileChangeItem, isToolBackedItem, type ToolBackedItem } from '../agents/items'
import { itemResultModelText } from '../utils/prune-messages'
import { textEncoderByteLength } from '../utils/hash'
import { estimateChatMessageTokens, estimateItemResultTokens, estimateTextTokens } from './tokens'
import { READ_RESULT_TOOLS } from './tool-classes'

export type OpKind = 'verbatim' | 'truncate' | 'oneline' | 'pointer' | 'elide' | 'fold'

/**
 * THE elision marker — the phrase every compression layer leaves in place of content
 * it removed, and the ONLY way anything downstream can tell that it did.
 *
 * It is not a label. It is a CONTRACT, read back by `.includes()` in two places that
 * both fail silently when it drifts:
 *
 *   1. THE RATCHET. Every layer guards `!text.includes(ELISION_MARKER)` before eliding
 *      (`heavyMutateInputs`, `recoverableReadResult`, `rewriteItem`, `elideToolCallArgs`).
 *      That guard is what makes compression idempotent — "an elided result never
 *      re-inflates, and never gets re-elided". Miss it and the pass squeezes pointers
 *      into pointers.
 *
 *   2. THE INTACT-OR-NOT QUESTION. `collectElidedToolCallIds` answers "does the model
 *      still have the full output of that call?" A `read` of an UNCHANGED file returns a
 *      stub — "scroll up to that earlier read" — which is only TRUE while the earlier
 *      read is intact. If the marker stops matching, the stub points the model at a
 *      pointer: it is told the content is above, and it is not.
 *
 * The pointer prose that carries it reads like copy, and nothing type-checks a template
 * literal — so a reword is a one-word change with a two-layer blast radius and no red
 * test. Every emitter therefore INTERPOLATES this constant rather than re-typing the
 * phrase (`context/pointers.ts`, `apply.ts`); `pointers.test.ts` pins that structurally.
 *
 * Siblings, same rule: `CRUSH_MARKER` (`crushers/index.ts`) and `MIDDLE_TRUNCATE_MARKER`
 * (`prune-wire.ts`).
 */
export const ELISION_MARKER = 'elided to save context'

/**
 * Does `text` CARRY one of our compression markers, as opposed to merely mentioning the
 * words? Every emitter wraps the marker in one bracketed placeholder — `[Old tool output
 * …`, `[… N chars …`, `[<label> …`, `[<CRUSH_MARKER> — …` — so requiring an unclosed `[`
 * before it on the same line is what separates OUR signal from DATA that contains the
 * phrase.
 *
 * A bare `.includes()` could not tell them apart, and the markers are ordinary English
 * sitting verbatim in this very file: an agent that reads or greps `op-menu.ts` fed
 * itself the signal. Its own read result was then judged already-compressed (so never
 * bounded), and — worse — its tool_call_id was latched into the session's elided set,
 * which flips `read` from a stub back to the whole file on every re-read for the rest of
 * the session. That is exactly the duplication read-dedup exists to stop.
 *
 * A tightening, not a proof: a document that writes the phrase INSIDE brackets still
 * forges it. What it buys is that our own source, a grep hit, and ordinary prose no
 * longer do.
 */
export function carriesMarker(text: string, marker: string): boolean {
  let from = 0
  for (;;) {
    const i = text.indexOf(marker, from)
    if (i < 0) return false
    // Walk back to the nearest `[` without crossing `]` or a line break.
    let j = i - 1
    while (j >= 0 && text[j] !== '[' && text[j] !== ']' && text[j] !== '\n') j--
    if (j >= 0 && text[j] === '[') return true
    from = i + marker.length
  }
}

/**
 * The heavy, recoverable string payloads a mutation tool call carries in its ARGS:
 * the `write`/`edit` content, the `apply_patch` body, an `edit`'s edits array, or
 * the `edit` single-edit shorthand (`old_string`/`new_string`). Returns the input
 * field names + texts so they can be measured and elided (the resulting file state
 * is on disk — re-readable).
 */
export function heavyMutateInputs(item: ToolBackedItem): Array<{ field: string; text: string }> {
  if (item.status !== 'completed') return []
  // A file_change that COMPLETED but has any FAILED hunk did not write those changes
  // to disk, so the patch/content args are NOT recoverable by re-reading. Keep them
  // verbatim: `tool_output` serves a heavy input back only when this helper reports
  // it, so eliding here would make the pointer promise a recovery of text the model
  // would then have to re-derive.
  if (isFileChangeItem(item) && item.changes.some((c) => c.failed)) return []
  const name = item.name
  const input = item.input as Record<string, unknown> | undefined
  if (!input || typeof input !== 'object') return []
  const out: Array<{ field: string; text: string }> = []
  const pushString = (field: string) => {
    const v = input[field]
    if (typeof v === 'string' && v && !carriesMarker(v, ELISION_MARKER))
      out.push({ field, text: v })
  }
  if (name === 'write' || name === 'edit') pushString('content')
  if (name === 'apply_patch' || name === 'patch') pushString('patch')
  if (name === 'edit') {
    if (Array.isArray(input.edits) && input.edits.length) {
      const text = JSON.stringify(input.edits)
      if (!carriesMarker(text, ELISION_MARKER)) out.push({ field: 'edits', text })
    }
    // single-edit shorthand: old_string/new_string at the top level
    pushString('old_string')
    pushString('new_string')
  }
  return out
}

/** The recoverable result text of a read-class tool item (re-readable), if any. */
export function recoverableReadResult(item: ToolBackedItem): string | undefined {
  if (item.status !== 'completed') return undefined
  if (!READ_RESULT_TOOLS.has(item.name)) return undefined
  const t = itemResultModelText(item)
  if (!t.length || carriesMarker(t, ELISION_MARKER)) return undefined // empty or already elided
  return t
}

export interface Operation {
  kind: OpKind
  /** Estimated token cost of the whole message under this op. */
  cost: number
  /** Fraction of the message's task-value retained under this op. */
  retention: number
  /** For `truncate`: keep at most this many leading chars of each tool result. */
  truncateChars?: number
  /**
   * Near-lossless: the content is recoverable elsewhere (re-readable from disk, or
   * superseded by a newer version). The allocator applies these regardless of budget.
   */
  lossless?: boolean
  /**
   * For `fold`: the tool-observation op it stacks on (the strongest one the message's menu had),
   * so applying a fold rewrites the observations exactly as its cost assumed. Absent when the
   * message has no compressible observations.
   */
  stackedOn?: Operation
}

export interface OpMenuOptions {
  truncateTiers?: number[]
  /** Don't bother compressing a message whose compressible payload is below this token cost. */
  minCompressibleTokens?: number
  /**
   * `toolCallId`s of items that must survive every op verbatim — the LIVE reads (see
   * `live-reads.ts`). They are excluded from BOTH stages of the menu, so the elide
   * cost never counts savings `applyPlan` will not make, and the lossy chain never
   * truncates them either.
   */
  protectedItemIds?: ReadonlySet<string>
}

const DEFAULT_TIERS = [2000, 500]
const ONELINE_TOKENS_PER_PART = 20
const POINTER_TOKENS_PER_PART = 10
const RETENTION = {
  truncate: (keptChars: number, totalChars: number) =>
    totalChars === 0 ? 1 : Math.min(1, keptChars / totalChars),
  oneline: 0.35,
  pointer: 0.12,
  recoverable: 0.95, // re-readable from disk / superseded → near-lossless
  // The head says what an answer was about and the tail how it ended; the middle is one
  // `history_search` away. Worth more than a masked observation, which says nothing.
  fold: 0.3,
}

/**
 * An assistant text shorter than this stays whole under `fold`: the head and tail kept plus the
 * recall marker would be most of it, so folding it would save nothing and cost the reader a gap.
 */
export const FOLD_MIN_CHARS = 1600
/** What a folded text keeps — head and tail together, the recall marker included. */
export const FOLD_KEEP_CHARS = 640

const bytesToTokens = (bytes: number) => Math.ceil(bytes / 4)

function toolItems(m: ChatMessage): ToolBackedItem[] {
  return (m.items ?? []).filter(isToolBackedItem)
}

/**
 * The assistant TEXT a `fold` would shorten: narrative text items long enough to be worth
 * folding and not already folded. User text is never offered — what the person said is the
 * last thing a context budget may paraphrase, and the planner evicts whole turns before it
 * would need to.
 */
export function foldableTexts(m: ChatMessage): string[] {
  if (m.role !== 'assistant') return []
  return (m.items ?? []).flatMap((item) =>
    item.type === 'text' &&
    item.text.length >= FOLD_MIN_CHARS &&
    !carriesMarker(item.text, ELISION_MARKER)
      ? [item.text]
      : [],
  )
}

/**
 * The `fold` op: every tool observation at its strongest downgrade, and the long assistant text
 * cut to its head and tail with a recall marker. It sits LAST in the menu on purpose — the
 * observation-masking result (arXiv 2508.21433) is that the agent's own words carry
 * the trajectory while old observations can go, so text is folded only after every observation
 * in the message is already a pointer.
 */
function foldOperation(m: ChatMessage, strongest: Operation): Operation | undefined {
  const texts = foldableTexts(m)
  if (texts.length === 0) return undefined
  const saved = texts.reduce(
    (sum, text) =>
      sum + estimateTextTokens(text) - estimateTextTokens(text.slice(0, FOLD_KEEP_CHARS)),
    0,
  )
  if (saved <= 0) return undefined
  return {
    kind: 'fold',
    cost: Math.max(0, strongest.cost - saved),
    retention: strongest.retention * RETENTION.fold,
    ...(strongest.kind === 'verbatim' ? {} : { stackedOn: strongest }),
  }
}

/**
 * Build the downgrade menu for message `m`. `isSuperseded` is a hint that the
 * message's observations are redundant (a newer version exists) — it's largely
 * subsumed by recoverable-content detection but kept for callers/tuning.
 */
export function operationMenu(
  m: ChatMessage,
  isSuperseded: boolean,
  opts: OpMenuOptions = {},
): Operation[] {
  const menu = toolOperationMenu(m, isSuperseded, opts)
  const fold = foldOperation(m, menu[menu.length - 1])
  if (fold) menu.push(fold)
  return menu
}

/** The tool-observation half of the menu: verbatim → elide → truncate tiers → oneline → pointer. */
function toolOperationMenu(
  m: ChatMessage,
  isSuperseded: boolean,
  opts: OpMenuOptions = {},
): Operation[] {
  const verbatimCost = estimateChatMessageTokens(m)
  const verbatim: Operation = { kind: 'verbatim', cost: verbatimCost, retention: 1 }
  const minCompressible = opts.minCompressibleTokens ?? 25
  const protectedIds = opts.protectedItemIds
  const items = protectedIds?.size
    ? toolItems(m).filter((it) => !protectedIds.has(it.toolCallId))
    : toolItems(m)

  // 1) Recoverable heavy content (write/edit/patch args + read results) → one
  //    near-lossless `elide` op applied regardless of budget.
  let recoverableBytes = 0
  let recoverableCount = 0
  for (const it of items) {
    const mis = heavyMutateInputs(it)
    if (mis.length) {
      for (const mi of mis) recoverableBytes += textEncoderByteLength(mi.text)
      recoverableCount += mis.length
      continue
    }
    const rr = recoverableReadResult(it)
    if (rr) {
      recoverableBytes += textEncoderByteLength(rr)
      recoverableCount++
    }
  }
  const menu: Operation[] = [verbatim]
  // Cost/retention floor the lossy chain continues FROM: verbatim, or — when the
  // message carries recoverable content — the elide op. A message mixing
  // recoverable I/O (read/write) with non-recoverable output (bash) must offer
  // BOTH stages in one menu, otherwise the allocator stalls at `elide` and the
  // bash output can never be compressed in the same pass (the menu would only
  // re-discover the lossy chain on the NEXT turn, after the marker is in place).
  let base = verbatimCost
  let baseRetention = 1
  if (recoverableBytes / 4 >= minCompressible) {
    const saved = recoverableCount * -POINTER_TOKENS_PER_PART + bytesToTokens(recoverableBytes)
    const cost = Math.max(0, verbatimCost - Math.max(0, saved))
    if (cost < verbatimCost) {
      baseRetention = isSuperseded ? 0.99 : RETENTION.recoverable
      menu.push({ kind: 'elide', cost, retention: baseRetention, lossless: true })
      base = cost
    }
  }

  // 2) Non-recoverable compressible results (bash etc.) → budget-driven lossy
  //    chain, stacked on top of the elide stage when one exists (its ops also
  //    elide the recoverable parts — see applyPlan).
  const lossy = items.filter(
    (it) =>
      it.status === 'completed' &&
      itemResultModelText(it).length > 0 &&
      // already-compressed placeholders are not compressible content
      !carriesMarker(itemResultModelText(it), ELISION_MARKER) &&
      heavyMutateInputs(it).length === 0 &&
      !recoverableReadResult(it),
  )
  if (lossy.length === 0) return menu
  const resultTokens = lossy.reduce((s, it) => s + estimateItemResultTokens(it), 0)
  if (resultTokens < minCompressible) return menu

  const baseTokens = base - resultTokens
  const totalResultChars = lossy.reduce((s, it) => s + itemResultModelText(it).length, 0)
  const pushIfCheaper = (op: Operation) => {
    if (op.cost < menu[menu.length - 1].cost) menu.push(op)
  }

  for (const k of opts.truncateTiers ?? DEFAULT_TIERS) {
    let cost = baseTokens
    let keptChars = 0
    for (const it of lossy) {
      const resultText = itemResultModelText(it)
      const keptText = resultText.slice(0, k)
      keptChars += keptText.length
      cost += estimateTextTokens(keptText)
    }
    pushIfCheaper({
      kind: 'truncate',
      cost,
      retention: baseRetention * RETENTION.truncate(keptChars, totalResultChars),
      truncateChars: k,
    })
  }
  pushIfCheaper({
    kind: 'oneline',
    cost: baseTokens + lossy.length * ONELINE_TOKENS_PER_PART,
    retention: baseRetention * RETENTION.oneline,
  })
  pushIfCheaper({
    kind: 'pointer',
    cost: baseTokens + lossy.length * POINTER_TOKENS_PER_PART,
    retention: baseRetention * RETENTION.pointer,
  })

  return menu
}
