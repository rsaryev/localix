/** Provider usage evidence and the anchored-prefix plus estimated-tail context policy. */
import type { ChatContextAnchorIdentity } from '@localixai/agent'
import type { PersistedMessage } from '../contracts'

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

export function estimateContextFromMessages<T extends { id: string }>(
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
      // the positional one the loop applies to any row it inserts out of order.
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
