import {
  CHAT_STREAM_DATA_TYPES,
  type ChatContextAttemptPayload,
  type ChatContextWindowPayload,
  type ChatDataPart,
} from '@localixai/agent'

import type { StoredMessagePayload } from '../../../db'
import type { ContextBudgetFrame } from './context-budget'
import { checkpointAtTokens } from './model-view/checkpoint-policy'

/**
 * The provenance label for a budget decision's token count, whatever its `estimateSource`. An
 * anchored figure is a provider measurement of an OLDER prefix plus a heuristic for what
 * followed it — the number a failed admission reports is never the provider's count of THIS
 * request. Two producers used to disagree (one relabeled the anchored figure "measured"); one
 * owner keeps the tooltip honest.
 */
export const BUDGET_DECISION_TOKEN_KIND = 'estimated' as const

export interface TerminalContextDiagnostics {
  window: ChatContextWindowPayload
  attempt: ChatContextAttemptPayload
}

export function contextWindowDiagnostics(
  sessionId: string,
  frame: ContextBudgetFrame,
  active?: { tokens: number; kind: ChatContextWindowPayload['activeTokensKind'] },
): ChatContextWindowPayload {
  return {
    sessionId,
    fullWindowTokens: frame.rawWindow,
    policyWindowTokens: frame.effectiveWindow,
    ceilingTokens: frame.trigger,
    checkpointAtTokens: checkpointAtTokens(frame),
    reservedTokens: frame.reserve,
    ...(active
      ? {
          activeTokens: active.tokens,
          activeTokensKind: active.kind,
        }
      : {}),
  }
}

/**
 * The window LIMITS, written as soon as the run knows them — before its first provider request.
 *
 * They used to arrive only with the terminal diagnostics, so through a session's whole first run
 * the composer's ring had no limits and fell back to the model's physical window: a delegated
 * child, budgeting against 128k, was drawn against 200k or 1M while it worked on its task. The
 * limits are known at the prompt stage, so they ride the first snapshot; the terminal write
 * replaces them with the same frame plus what the run measured.
 */
export function withContextWindowLimits(
  payload: StoredMessagePayload,
  window: ChatContextWindowPayload,
): StoredMessagePayload {
  const retained = (payload.dataParts ?? []).filter(
    (part) => part.type !== CHAT_STREAM_DATA_TYPES.contextWindow,
  )
  return {
    ...payload,
    dataParts: [...retained, { type: CHAT_STREAM_DATA_TYPES.contextWindow, data: window }],
  }
}

/**
 * Replace the two terminal context facts atomically while preserving unrelated
 * application/plugin data parts. One part describes limits; the other describes
 * the newest attempt, so stale successful usage is never relabeled as a failure.
 */
export function withTerminalContextDiagnostics(
  payload: StoredMessagePayload,
  diagnostics: TerminalContextDiagnostics,
): StoredMessagePayload {
  const replacedTypes = new Set<string>([
    CHAT_STREAM_DATA_TYPES.contextWindow,
    CHAT_STREAM_DATA_TYPES.contextAttempt,
  ])
  const retained = (payload.dataParts ?? []).filter((part) => !replacedTypes.has(part.type))
  const parts: ChatDataPart[] = [
    ...retained,
    {
      type: CHAT_STREAM_DATA_TYPES.contextWindow,
      data: diagnostics.window,
    },
    {
      type: CHAT_STREAM_DATA_TYPES.contextAttempt,
      data: diagnostics.attempt,
    },
  ]
  return { ...payload, dataParts: parts }
}
