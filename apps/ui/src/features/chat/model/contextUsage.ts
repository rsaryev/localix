import type {
  ChatContextAttemptPayload,
  ChatContextWindowPayload,
  ChatContextTokenKind,
  ChatDataPart,
  ChatErrorPayload,
  ChatUsagePayload,
} from '@localixai/agent'
import { hasRecordedUsage } from '@localixai/agent'

export interface ContextAttemptSnapshot extends ChatContextAttemptPayload {
  messageId: string
}

/**
 * The current context-budget frame. `policyWindowTokens` and
 * `activeTokensKind` are forward-compatible additions expected from the
 * runtime. Older `data-context-window` producers remain valid.
 */
export type ContextWindowDiagnostics = ChatContextWindowPayload

const ATTEMPT_PART_TYPE = 'data-context-attempt'

export type ContextTokenKind = ChatContextTokenKind

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isAttemptOutcome(value: unknown): value is ChatContextAttemptPayload['outcome'] {
  return value === 'running' || value === 'succeeded' || value === 'failed' || value === 'unknown'
}

function isAttemptStage(value: unknown): value is ChatContextAttemptPayload['stage'] {
  return value === 'preflight' || value === 'provider' || value === 'unknown'
}

function isTokenKind(value: unknown): value is ChatContextTokenKind {
  return value === 'measured' || value === 'estimated' || value === 'unknown'
}

function parseAttemptPart(data: unknown): ChatContextAttemptPayload | undefined {
  if (!data || typeof data !== 'object') return undefined
  const value = data as Record<string, unknown>
  if (
    !isAttemptOutcome(value.outcome) ||
    !isAttemptStage(value.stage) ||
    !isTokenKind(value.tokenKind)
  ) {
    return undefined
  }
  if (value.contextTokens !== undefined && !isFiniteNonNegative(value.contextTokens)) {
    return undefined
  }
  return {
    outcome: value.outcome,
    stage: value.stage,
    contextTokens: value.contextTokens,
    tokenKind: value.contextTokens === undefined ? 'unknown' : value.tokenKind,
  }
}

function lastPartData<T>(
  dataParts: readonly ChatDataPart[] | undefined,
  type: string,
): T | undefined {
  if (!dataParts) return undefined
  for (let index = dataParts.length - 1; index >= 0; index -= 1) {
    const part = dataParts[index]
    if (part?.type === type) return part.data as T
  }
  return undefined
}

export function contextWindowFromParts(
  dataParts: readonly ChatDataPart[] | undefined,
): ContextWindowDiagnostics | undefined {
  return lastPartData<ContextWindowDiagnostics>(dataParts, 'data-context-window')
}

/**
 * Resolve an attempt using explicit diagnostics first. The fallbacks only make
 * claims supported by existing typed transport data:
 *
 * - recorded usage proves a provider request completed;
 * - a chat-error part proves the attempt failed, but not at which stage;
 * - otherwise the outcome and context are unknown (never inferred from prose).
 */
export function contextAttemptFromMessage(message: {
  id: string
  usage?: ChatUsagePayload
  dataParts?: ChatDataPart[]
}): ContextAttemptSnapshot {
  const explicit = parseAttemptPart(lastPartData<unknown>(message.dataParts, ATTEMPT_PART_TYPE))
  if (explicit) return { messageId: message.id, ...explicit }

  if (hasRecordedUsage(message.usage)) {
    return {
      messageId: message.id,
      outcome: 'succeeded',
      stage: 'provider',
      contextTokens: message.usage.contextTokens,
      tokenKind: message.usage.contextTokens === undefined ? 'unknown' : 'measured',
    }
  }

  const error = lastPartData<ChatErrorPayload>(message.dataParts, 'data-chat-error')
  return {
    messageId: message.id,
    outcome: error ? 'failed' : 'unknown',
    stage: 'unknown',
    tokenKind: 'unknown',
  }
}
