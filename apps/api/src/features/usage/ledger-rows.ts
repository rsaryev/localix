import { recoveredUsage } from './recovered-usage'
import type { UsageEventInput } from './usage-types'

/**
 * A chat turn's usage-ledger row, derived from its assistant message. Pure: the queries that read
 * the messages and write the rows live in `ledger-repository.ts`.
 */

/** The columns `selectLedgerSources` reads for one assistant message. */
export interface LedgerSourceRow {
  message_id: string
  session_id: string
  user_id: string
  payload_json: string
  created_at: string
  root_session_id: string | null
  model_id: string | null
  agent_id: string | null
  provider_connection_id: string | null
  finish_reason: string | null
}

/** The provider namespace of a stored `provider/model` id, or null when it has none. */
function providerNamespace(modelId: string): string | null {
  const slash = modelId.indexOf('/')
  return slash > 0 ? modelId.slice(0, slash) : null
}

/**
 * The stored model id: `provider/model`. A recorded id may already carry its provider's namespace
 * or be bare; this only spells the id for storage and decides nothing about whether it can run.
 */
export function qualifiedModelId(providerId: string | null, modelId: string): string {
  if (!providerId || providerNamespace(modelId) === providerId) return modelId
  return `${providerId}/${modelId}`
}

/** The ledger row for one assistant message, or null when the message carries no usage. */
export function ledgerRowEvent(row: LedgerSourceRow) {
  const usage = recoveredUsage(row.payload_json)
  if (!usage) return null
  const turn = usage.turnEnd
  const sessionModelId = row.model_id ?? ''
  const providerId = turn?.providerId ?? usage.providerId ?? providerNamespace(sessionModelId)
  const modelId =
    turn?.modelId ?? (usage.modelId ? qualifiedModelId(providerId, usage.modelId) : sessionModelId)
  // A later model switch makes the session's current connection stale for this message.
  // Retain it only when its model snapshot still agrees.
  const providerConnectionId =
    turn?.providerConnectionId ?? (modelId === sessionModelId ? row.provider_connection_id : null)
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  const event: UsageEventInput = {
    messageId: row.message_id,
    sessionId: row.session_id,
    rootSessionId: row.root_session_id ?? row.session_id,
    userId: row.user_id,
    createdAt: row.created_at,
    providerConnectionId,
    providerId,
    modelId,
    inputTokens,
    outputTokens,
    cacheReadTokens: usage.cachedInputTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    cacheWrite1hTokens: usage.cacheWrite1hTokens ?? 0,
    reasoningTokens: usage.reasoningTokens ?? 0,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
    costUsd: usage.totalCost ?? 0,
    costSource: usage.costSource,
    finishReason: turn?.finishReason ?? null,
    durationMs: usage.modelMs ?? null,
    keyId: turn?.keyId ?? null,
    keyLabel: usage.keyLabel ?? null,
    keyMasked: usage.keyMasked ?? null,
    agentId: usage.agentId ?? row.agent_id ?? null,
  }
  return { event, usage, turn }
}
