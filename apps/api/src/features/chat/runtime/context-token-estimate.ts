import {
  estimateChatMessageTokens,
  IMAGE_TOKEN_ESTIMATE,
  textEncoderByteLength,
  type ChatMessage,
} from '@localixai/agent'
import type { PersistedMessage } from '../contracts'
import {
  estimateContextFromMessages,
  type ContextUsageAnchor,
  type ContextAnchorIdentity,
  type ContextTokenEstimate,
} from './context-usage-anchor'
export {
  createContextAnchorIdentity,
  contextAnchorIdentityMatches,
  lastTurnContextAnchor,
  type ContextUsageAnchor,
  type ContextAnchorIdentity,
  type ContextAnchorProof,
  type ContextTokenEstimate,
} from './context-usage-anchor'

// UTF-8-byte-based token estimators used to admit a request and to price a checkpoint
// before any provider has measured it. Deliberately cheap and provider-agnostic — these
// gate the history, they don't bill anything.

// One turn estimates the same rows more than once (the row budget of the history
// pipeline and the hybrid anchor-plus-tail estimate both walk them). Memoise by
// message identity so the JSON.stringify-heavy body runs once per object. The
// WeakMap auto-evicts when a message is GC'd, and persisted messages are never
// mutated in place, so identity caching stays correct.
const tokenEstimateCache = new WeakMap<PersistedMessage, number>()
const estimateTextTokens = (text: string): number => Math.ceil(textEncoderByteLength(text) / 4)

/**
 * The exact text envelope used when a slash/plugin invocation is materialized
 * as a model-facing attachment. Keeping the renderer beside the proactive
 * estimator prevents the two from drifting: an instruction that reaches the
 * wire must cost tokens in the admission estimate too.
 */
export function invocationModelText(
  binding: Extract<NonNullable<ChatMessage['bindings']>[number], { kind: 'invocation' }>,
): string | undefined {
  if (!binding.instruction) return undefined
  return `--- Invocation (${binding.invocation.kind}:${binding.invocation.name}) ---\n${binding.instruction}\n--- End invocation ---`
}

export function estimateMessageTokens(m: PersistedMessage): number {
  const cached = tokenEstimateCache.get(m)
  if (cached !== undefined) return cached
  const tokens = computeMessageTokens(m)
  tokenEstimateCache.set(m, tokens)
  return tokens
}

function computeMessageTokens(m: PersistedMessage): number {
  // The shared VBC estimator counts what the model wire actually replays: string
  // content, tool-item inputs + model-facing results, and attachments (flat
  // per-image allowance). Counting `payload.content` alone — the old behavior —
  // ignored `items` entirely, so a tool-heavy history (where tool I/O dominates)
  // was undercounted by an order of magnitude: the size gate never fired and the
  // "recent tail" cut kept far more than its token budget.
  const base = estimateChatMessageTokens(m.payload as unknown as ChatMessage)
  const c = m.payload.content as unknown
  if (!Array.isArray(c)) return base
  // Legacy array-of-parts content (the shared estimator only counts string
  // content): count text-ish parts by chars + a flat allowance per image part.
  let tokens = 0
  let images = 0
  for (const part of c as Array<Record<string, unknown>>) {
    const t = part?.type
    if (t === 'image' || t === 'image_url' || t === 'input_image') images += 1
    else tokens += estimateTextTokens(JSON.stringify(part))
  }
  return base + tokens + images * IMAGE_TOKEN_ESTIMATE
}

export function estimateHistoryTokens(messages: PersistedMessage[]): number {
  let total = 0
  for (const m of messages) total += estimateMessageTokens(m)
  return total
}

/**
 * The same anchored rule applied after model-facing attachment materialization.
 *
 * Prefix transformations (image downscale, attachment spill, VBC) only make the
 * provider-measured prefix smaller. Messages after the anchor are estimated from
 * their actual wire-facing payload, so current runtime context and invocation
 * attachments are charged without re-estimating the already measured prefix.
 */
export function estimateModelContextTokens(
  messages: readonly ChatMessage[],
  lastUsage?: ContextUsageAnchor,
  fixedOverheadTokens = 0,
  currentIdentity?: ContextAnchorIdentity,
): ContextTokenEstimate {
  return estimateContextFromMessages(
    messages,
    estimateChatMessageTokens,
    lastUsage,
    fixedOverheadTokens,
    currentIdentity,
  )
}
