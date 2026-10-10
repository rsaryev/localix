import { toSqliteDateTime } from '../../lib/sqlite-time'
import type { UsageEventInput } from './usage-types'

function sqliteCreatedAt(value: string): string | undefined {
  if (!value.includes('T')) return value
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? toSqliteDateTime(date) : undefined
}

export const mutableColumns = (event: UsageEventInput) => ({
  provider_id: event.providerId ?? null,
  model_id: event.modelId,
  input_tokens: event.inputTokens ?? 0,
  output_tokens: event.outputTokens ?? 0,
  cache_read_tokens: event.cacheReadTokens ?? 0,
  cache_write_tokens: event.cacheWriteTokens ?? 0,
  cache_write_1h_tokens: event.cacheWrite1hTokens ?? 0,
  reasoning_tokens: event.reasoningTokens ?? 0,
  total_tokens: event.totalTokens ?? 0,
  cost_usd: event.costUsd ?? 0,
  cost_source: event.costSource ?? 'estimated',
  finish_reason: event.finishReason ?? null,
  duration_ms: event.durationMs ?? null,
  key_id: event.keyId ?? null,
  key_label: event.keyLabel ?? null,
  key_masked: event.keyMasked ?? null,
  // Mutable, not identity: a room rotates the party so the speaker is first, and a re-persist
  // of the same message re-derives the speaker the same way. Keeping it with the other
  // re-derived columns means a row written before the rotation landed is repaired, not frozen.
  agent_id: event.agentId ?? null,
})

export const insertColumns = (event: UsageEventInput) => {
  const createdAt = event.createdAt ? sqliteCreatedAt(event.createdAt) : undefined
  return {
    message_id: event.messageId,
    session_id: event.sessionId,
    root_session_id: event.rootSessionId ?? null,
    user_id: event.userId,
    provider_connection_id: event.providerConnectionId ?? null,
    ...(createdAt ? { created_at: createdAt } : {}),
    ...mutableColumns(event),
  }
}
