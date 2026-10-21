/**
 * HOW A RESPONSE ENDED, in Localix terms: the provider SDK's finish reason as the loop's stop
 * reason, and its usage as the counts a cost ledger prices.
 */
import type { LanguageModelV4FinishReason, LanguageModelV4Usage } from '@ai-sdk/provider'
import type { StopReason } from '@localixai/agent'

export function stopReasonOf(
  reason: LanguageModelV4FinishReason,
  hasToolCalls: boolean,
): StopReason {
  switch (reason.unified) {
    case 'stop':
      return hasToolCalls ? 'tool_use' : 'end_turn'
    case 'tool-calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'content-filter':
    case 'error':
      return 'error'
    // A provider-specific reason the SDK could not map: judged by what the response holds.
    case 'other':
      return hasToolCalls ? 'tool_use' : 'end_turn'
  }
}

export interface AssembledUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

export function usageOf(usage: LanguageModelV4Usage): AssembledUsage {
  const input =
    usage.inputTokens.total ??
    (usage.inputTokens.noCache ?? 0) +
      (usage.inputTokens.cacheRead ?? 0) +
      (usage.inputTokens.cacheWrite ?? 0)
  return {
    inputTokens: input,
    outputTokens: usage.outputTokens.total ?? 0,
    ...(usage.inputTokens.cacheRead !== undefined
      ? { cacheReadTokens: usage.inputTokens.cacheRead }
      : {}),
    ...(usage.inputTokens.cacheWrite !== undefined
      ? { cacheWriteTokens: usage.inputTokens.cacheWrite }
      : {}),
    ...(usage.outputTokens.reasoning !== undefined
      ? { reasoningTokens: usage.outputTokens.reasoning }
      : {}),
  }
}
