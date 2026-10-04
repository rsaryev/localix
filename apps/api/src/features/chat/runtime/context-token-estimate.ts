import {
  estimateChatMessageTokens,
  IMAGE_TOKEN_ESTIMATE,
  textEncoderByteLength,
  type ChatContextAnchorIdentity,
  type ChatMessage,
} from '@localixai/agent'
import type { PersistedMessage } from '../contracts'

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

export interface ContextUsageAnchor {
  tokens: number
  messageId: string
  /** Proof that the measured request used the same static context envelope. */
  identity?: ContextAnchorIdentity
  /** Durable legacy proof available before full context identity was persisted. */
  legacyProvider?: { providerId: string; modelId: string }
}

export type ContextAnchorIdentity = ChatContextAnchorIdentity

export interface ContextAnchorProof {
  messageId: string
  identity: ContextAnchorIdentity
}

export interface ContextTokenEstimate {
  tokens: number
  source: 'provider_anchor' | 'heuristic'
  /** Tokens estimated after the provider-measured prefix. */
  trailingTokens: number
  anchorMessageId?: string
}

const normalizeTokenCount = (tokens: number | undefined): number =>
  typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : 0

/**
 * Fingerprint every static component included in a provider usage measurement.
 *
 * The tool hash uses the prepared provider-neutral JSON schema rather than tool
 * names alone: changing a parameter description or enum changes prompt tokens
 * even when the visible tool inventory is unchanged.
 */
export function createContextAnchorIdentity(options: {
  providerId: string
  modelId: string
  boundaryId?: string
  systemPromptHash: string
  toolSchemaHash: string
  fixedOverheadTokens?: number
}): ContextAnchorIdentity {
  return {
    providerId: options.providerId,
    modelId: options.modelId,
    boundaryId: options.boundaryId ?? '',
    systemPromptHash: options.systemPromptHash,
    toolSchemaHash: options.toolSchemaHash,
    fixedOverheadTokens: normalizeTokenCount(options.fixedOverheadTokens),
  }
}

export function contextAnchorIdentityMatches(
  left: ContextAnchorIdentity | undefined,
  right: ContextAnchorIdentity | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.providerId === right.providerId &&
    left.modelId === right.modelId &&
    left.boundaryId === right.boundaryId &&
    left.systemPromptHash === right.systemPromptHash &&
    left.toolSchemaHash === right.toolSchemaHash &&
    left.fixedOverheadTokens === right.fixedOverheadTokens
  )
}

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

function estimateContextFromMessages<T extends { id: string }>(
  messages: readonly T[],
  estimateMessage: (message: T) => number,
  lastUsage?: ContextUsageAnchor,
  fixedOverheadTokens = 0,
  currentIdentity?: ContextAnchorIdentity,
): ContextTokenEstimate {
  const measuredTokens =
    lastUsage && Number.isFinite(lastUsage.tokens) && lastUsage.tokens > 0
      ? Math.floor(lastUsage.tokens)
      : undefined
  if (
    lastUsage &&
    measuredTokens !== undefined &&
    (contextAnchorIdentityMatches(lastUsage.identity, currentIdentity) ||
      (lastUsage.identity === undefined &&
        currentIdentity !== undefined &&
        lastUsage.legacyProvider?.providerId === currentIdentity.providerId &&
        lastUsage.legacyProvider.modelId === currentIdentity.modelId))
  ) {
    const idx = messages.findIndex((message) => message.id === lastUsage.messageId)
    if (idx >= 0) {
      let trailingTokens = 0
      for (let i = idx + 1; i < messages.length; i++) {
        trailingTokens += estimateMessage(messages[i])
      }
      return {
        // A full identity proves the measured usage already includes the same
        // static floor. Legacy rows prove only provider/model; charge the FULL
        // current floor again so changed prompts/schemas cannot undercount.
        tokens:
          measuredTokens +
          trailingTokens +
          (lastUsage.identity === undefined ? normalizeTokenCount(fixedOverheadTokens) : 0),
        source: 'provider_anchor',
        trailingTokens,
        anchorMessageId: lastUsage.messageId,
      }
    }
  }

  let historyTokens = 0
  for (const message of messages) historyTokens += estimateMessage(message)
  const fixedOverhead =
    Number.isFinite(fixedOverheadTokens) && fixedOverheadTokens > 0
      ? Math.floor(fixedOverheadTokens)
      : 0
  return {
    tokens: historyTokens + fixedOverhead,
    source: 'heuristic',
    trailingTokens: historyTokens,
  }
}

/**
 * Hybrid context-size estimate (pi `estimateContextTokens`): when the last
 * assistant turn's actual usage is known, trust it for everything up to and
 * including that message and char-estimate only the trailing messages; otherwise
 * estimate everything by characters. Provider `usage` isn't universal, so this
 * degrades gracefully.
 *
 * `fixedOverheadTokens` is the system prompt + tool schemas — the part of every request the
 * HISTORY does not contain (often five figures once prepared JSON schemas are counted).
 * It is added ONLY on the char-estimate path: an anchored
 * `usage.contextTokens` is the provider's real per-request count and already includes it.
 *
 * Measured on real runs where `contextTokens` was actually being written: the anchor is present
 * for 94% of runs that have any prior assistant turn, and for 41% of runs overall — the gap is entirely the
 * FIRST run of a session, which has nothing to anchor on. So the char path is, in practice,
 * "the opening run", where the history is small and the fixed floor is the dominant term: on a
 * 32k-window model this floor can consume a large part of the window before a single
 * conversation message is counted.
 *
 * Same rule the loop's max-tokens clamp uses (`extraTokens`, counted only when unanchored).
 */
export function estimateContextTokens(
  messages: PersistedMessage[],
  lastUsage?: ContextUsageAnchor,
  fixedOverheadTokens = 0,
  currentIdentity?: ContextAnchorIdentity,
): number {
  return estimateContextTokenDetails(messages, lastUsage, fixedOverheadTokens, currentIdentity)
    .tokens
}

/** Detailed form used by context policy and diagnostics. */
export function estimateContextTokenDetails(
  messages: readonly PersistedMessage[],
  lastUsage?: ContextUsageAnchor,
  fixedOverheadTokens = 0,
  currentIdentity?: ContextAnchorIdentity,
): ContextTokenEstimate {
  return estimateContextFromMessages(
    messages,
    estimateMessageTokens,
    lastUsage,
    fixedOverheadTokens,
    currentIdentity,
  )
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

/**
 * The usage anchor for {@link estimateContextTokens}: the newest assistant
 * message carrying `usage.contextTokens` — the provider's REAL per-request
 * context size at that turn (input + output of the run's final request, set in
 * turn-state/event-handlers). The other `usage` token fields are SUMS over every
 * turn of a run (a 30-turn tool run re-bills its context each turn), so a
 * legacy row without `contextTokens` is deliberately skipped — the char
 * heuristic (items-aware) is far closer than a run-sum.
 */
export function lastTurnContextAnchor(
  messages: PersistedMessage[],
  proof?: ContextAnchorProof,
): ContextUsageAnchor | undefined {
  let anchor: ContextUsageAnchor | undefined
  let newestPrefixTimestamp = Number.NEGATIVE_INFINITY
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const timestamp = Date.parse(m.createdAt)
    const timestampIsKnown = Number.isFinite(timestamp)
    if (m.payload.role === 'assistant') {
      const ctx = m.payload.usage?.contextTokens
      // A row that is older than a row projected in front of it was measured under a
      // prefix that did not have that row, so its provider usage must not anchor this
      // one. The checkpoint epoch in the anchor identity is the primary guard; this is
      // the positional one PI applies to any row it inserts out of order.
      const appliesToCurrentPrefix = !timestampIsKnown || timestamp >= newestPrefixTimestamp
      if (appliesToCurrentPrefix && typeof ctx === 'number' && Number.isFinite(ctx) && ctx > 0) {
        const persistedIdentity = m.payload.usage?.contextIdentity
        const providerId = m.payload.providerMeta?.providerId
        const modelId = m.payload.providerMeta?.modelId
        anchor = {
          tokens: Math.floor(ctx),
          messageId: m.id,
          ...(persistedIdentity
            ? { identity: persistedIdentity }
            : proof?.messageId === m.id
              ? { identity: proof.identity }
              : {}),
          ...(!persistedIdentity &&
          typeof providerId === 'string' &&
          providerId.length > 0 &&
          typeof modelId === 'string' &&
          modelId.length > 0
            ? { legacyProvider: { providerId, modelId } }
            : {}),
        }
      }
    }
    if (timestampIsKnown) newestPrefixTimestamp = Math.max(newestPrefixTimestamp, timestamp)
  }
  return anchor
}
