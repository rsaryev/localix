/**
 * Cheap, model-agnostic token estimation over the persisted `ChatMessage` shape
 * for the Value-Budgeted Context Compression (VBC) allocator.
 *
 * The app-side `estimateContextTokens` only sees `payload.content`; VBC needs the
 * cost of each tool-backed `AgentItem` (input + model-facing result), since tool
 * outputs are the dominant token sink. Same ~4 UTF-8 bytes/token heuristic + flat
 * per-image allowance the rest of the codebase uses — good enough to decide WHAT
 * to shrink. Rich display-only payloads (command `output`, file_change `diff`) are
 * UI-only and never re-enter the model prompt, so they're excluded from the cost.
 */
import { assetBindings, contextContributionModelText, type ChatMessage } from '../chat'
import { isToolBackedItem, type ToolBackedItem } from '../agents/items'
import { itemResultModelText } from '../utils/prune-messages'
import { textEncoderByteLength } from '../utils/hash'
import type { Message } from '../types'
import { DEFAULT_IMAGE_TOKENS, type WireSizeSample } from './token-calibration'

/**
 * Flat token allowance for an inline image part before a provider has taught the model's real
 * cost (see `token-calibration.ts`).
 */
export const IMAGE_TOKEN_ESTIMATE = DEFAULT_IMAGE_TOKENS

const BYTES_PER_TOKEN = 4

function bytesToTokens(bytes: number): number {
  return Math.ceil(bytes / BYTES_PER_TOKEN)
}

/**
 * Conservative model-agnostic text estimate. UTF-8 bytes (rather than JS UTF-16
 * code units) avoid severe undercounts for Cyrillic, CJK, and emoji while
 * preserving the familiar ASCII chars/4 result.
 */
export function estimateTextTokens(text: string): number {
  return bytesToTokens(textEncoderByteLength(text))
}

// Memoized by object identity: the VBC planner makes SEVERAL O(history) passes
// per run (dep-graph, scoring, operation menus, tail sizing) over the SAME
// parsed message/item objects, and `estimateItemTokens` JSON.stringifies every
// tool input each time — the dominant synchronous cost of planning on long
// sessions, paid on the one Bun thread every session shares. History objects
// are never mutated during planning, so identity keying is sound; a fresh parse
// (next run) simply repopulates.
const itemTokenCache = new WeakMap<object, number>()
const messageTokenCache = new WeakMap<object, number>()

/**
 * Size of one WIRE message, memoized by object identity.
 *
 * The wire is serialized to be measured, and on a long session that serialization is the
 * dominant synchronous cost of a turn — measured at ~30 MB of `JSON.stringify` per turn on
 * a 1 MB history in a 30-iteration tool loop, on the single thread every session shares.
 * Both places that measure a wire (the per-request prune and the host's request policy) had
 * their own private WeakMap doing exactly this, on the same immutability argument: a changed
 * message is a NEW object, never a mutated one, so identity keying is sound and a fresh
 * parse simply repopulates.
 *
 * One cache rather than two is not only less code — it is what makes the two layers agree
 * on a message's size. Two estimators drifting by a few tokens is how an admission check
 * starts refusing a request that fits.
 */
const wireSizeCache = new WeakMap<object, WireSizeSample>()

/**
 * Size of one WIRE message in the two currencies a calibration separates: heuristic text
 * tokens and the number of inline images. `estimateWireMessageTokens` is this at the default
 * image allowance; a host with a learned calibration prices the same size differently.
 */
export function estimateWireMessageSize(message: object): WireSizeSample {
  const hit = wireSizeCache.get(message)
  if (hit !== undefined) return hit
  // Media is scored separately from text.
  // Base64 is transport encoding, not text tokens. Only inspect typed content slots:
  // a tool argument containing { type: 'image', data: ... } is still ordinary JSON input.
  let images = 0
  const content = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map((part) => {
          if (part?.type !== 'image') return part
          images += 1
          return { type: 'image' }
        })
      : value
  const wire = message as Message
  const sized =
    wire.role === 'user'
      ? { ...wire, content: content(wire.content) }
      : wire.role === 'tool'
        ? {
            ...wire,
            // The codec's top-level mirror is not another copy of the tool result.
            content: undefined,
            details: undefined,
            results: wire.results.map((result) => ({
              ...result,
              details: undefined,
              content: content(result.content),
            })),
          }
        : message
  const size: WireSizeSample = { textTokens: estimateTextTokens(JSON.stringify(sized)), images }
  wireSizeCache.set(message, size)
  return size
}

/** Sum of {@link estimateWireMessageSize} over a wire, for a calibration sample. */
export function estimateWireSize(messages: readonly object[]): WireSizeSample {
  let textTokens = 0
  let images = 0
  for (const message of messages) {
    const size = estimateWireMessageSize(message)
    textTokens += size.textTokens
    images += size.images
  }
  return { textTokens, images }
}

/** One wire message at the uncalibrated default image allowance. */
export function estimateWireMessageTokens(message: object): number {
  const size = estimateWireMessageSize(message)
  return size.textTokens + size.images * IMAGE_TOKEN_ESTIMATE
}

/** Approximate token cost of a single tool-backed item: input, result, and opaque model state. */
export function estimateItemTokens(item: ToolBackedItem): number {
  const cached = itemTokenCache.get(item)
  if (cached !== undefined) return cached
  const inputBytes = item.input != null ? textEncoderByteLength(JSON.stringify(item.input)) : 0
  const resultBytes = textEncoderByteLength(itemResultModelText(item))
  // The wire replays this signature on the tool-call part for the same provider/model.
  // It can contain a large encrypted reasoning payload, so treating it as free can
  // defeat VBC's context bound even when visible text is tiny.
  const signatureBytes = item.thoughtSignature ? textEncoderByteLength(item.thoughtSignature) : 0
  // Returned images ride the replay beside the text (`withToolImages`), priced like an attached
  // one. Counted whether or not this request carries the bytes: an overcount compresses a touch
  // early, an undercount overflows.
  const images = item.attachments?.filter((att) => att.kind === 'image').length ?? 0
  const tokens =
    bytesToTokens(inputBytes + resultBytes + signatureBytes) + images * IMAGE_TOKEN_ESTIMATE
  itemTokenCache.set(item, tokens)
  return tokens
}

/** Approximate token cost of the model-facing result text of a tool-backed item only. */
export function estimateItemResultTokens(item: ToolBackedItem): number {
  return estimateTextTokens(itemResultModelText(item))
}

/**
 * Approximate token cost of a whole `ChatMessage` as it is replayed to the model:
 * text content + tool-item inputs/results + a flat allowance per image attachment.
 * Unsigned prior-turn reasoning is excluded. Signature-bearing narrative parts are
 * provider protocol state and are replayed, so both their text and opaque signature count.
 */
export function estimateChatMessageTokens(m: ChatMessage): number {
  const cached = messageTokenCache.get(m)
  if (cached !== undefined) return cached
  const contentBytes = typeof m.content === 'string' ? textEncoderByteLength(m.content) : 0
  // An assistant turn is replayed to the model from its `text` ITEMS, not from
  // `m.content` (see `toModelMessages`/`itemsToWireMessages` in agents/chat.ts —
  // `m.content` is only the UI mirror). They coincide for our own turns
  // (content === concatenated text items), but an items-only history (CLI-adapter /
  // external sub-agent turns leave `content` empty while the wire still sends the
  // text items) would be undercounted to zero — under-compressing and risking a
  // context-window overflow. Take the LARGER of the two so the estimate never falls
  // below what the wire actually carries; an overcount only compresses a touch
  // early, an undercount overflows.
  const textItemBytes = (m.items ?? []).reduce(
    (n, item) =>
      n +
      (item.type === 'text' && typeof item.text === 'string'
        ? textEncoderByteLength(item.text)
        : 0),
    0,
  )
  const textBytes = Math.max(contentBytes, textItemBytes)
  const signedNarrativeBytes = (m.items ?? []).reduce((total, item) => {
    if (item.type === 'text') {
      return total + (item.textSignature ? textEncoderByteLength(item.textSignature) : 0)
    }
    if (item.type === 'reasoning' && item.thinkingSignature) {
      return (
        total + textEncoderByteLength(item.text) + textEncoderByteLength(item.thinkingSignature)
      )
    }
    return total
  }, 0)
  const attachmentTotals = assetBindings(m.bindings).reduce(
    (acc, attachment) => {
      if (attachment.kind === 'image') acc.images += 1
      // For a `text` attachment we count its UTF-8 bytes. A SPILLED attachment's
      // `text` is just its manifest + head preview (the bytes live on disk and are
      // re-read lazily), so this already reflects the small wire footprint — there
      // is no full-file cost to add back.
      else if (attachment.kind === 'text') acc.bytes += textEncoderByteLength(attachment.text)
      return acc
    },
    { bytes: textBytes + signedNarrativeBytes, images: 0 },
  )
  // Resolved context bindings are materialized as text attachments immediately
  // before the request (see contextBindingsToModelAssets). Count the exact same
  // envelope here; otherwise the admission estimate and the checkpoint trigger see
  // only the short @mention while VBC later sees the full schema/document snapshot.
  const contextBindingBytes = (m.bindings ?? []).reduce((total, binding) => {
    if (binding.kind !== 'context') return total
    return (
      total +
      binding.resolution.contributions.reduce(
        (sum, contribution) =>
          sum + textEncoderByteLength(contextContributionModelText(contribution)),
        0,
      )
    )
  }, 0)
  const itemTokens = (m.items ?? []).reduce(
    (total, item) => total + (isToolBackedItem(item) ? estimateItemTokens(item) : 0),
    0,
  )
  const tokens =
    bytesToTokens(attachmentTotals.bytes + contextBindingBytes) +
    attachmentTotals.images * IMAGE_TOKEN_ESTIMATE +
    itemTokens
  messageTokenCache.set(m, tokens)
  return tokens
}

/** Sum of {@link estimateChatMessageTokens} over a conversation. */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0
  for (const m of messages) total += estimateChatMessageTokens(m)
  return total
}
