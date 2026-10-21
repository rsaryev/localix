import {
  cacheHitRate,
  combineUsage,
  hasRecordedUsage,
  uncachedInputTokens,
  type ChatCacheDiagnosticsPayload,
  type ChatUsagePayload,
} from '@localixai/agent'
import { findLast } from '@localixai/plugin-sdk/ui/utilities'

/** Minimal message shape these selectors read — kept structural so this module
 *  stays decoupled from the full UI Message type. */
interface UsageMessage {
  role: string
  usage?: ChatUsagePayload
  cacheDiagnostics?: ChatCacheDiagnosticsPayload
}

/** Per-turn usage payloads from assistant messages that actually recorded tokens. */
export function selectAssistantUsage(messages: readonly UsageMessage[]): ChatUsagePayload[] {
  return messages.flatMap((message) => {
    if (message.role !== 'assistant' || !hasRecordedUsage(message.usage)) return []
    return [message.usage]
  })
}

/** Cache diagnostics from the most recent assistant message that carried them. */
export function selectLatestCacheDiagnostics(
  messages: readonly UsageMessage[],
): ChatCacheDiagnosticsPayload | undefined {
  return findLast(
    messages,
    (message) => message.role === 'assistant' && Boolean(message.cacheDiagnostics),
  )?.cacheDiagnostics
}

/**
 * Cache-hit rate as a whole percent: `cacheRead / inputTokens`. `inputTokens` is
 * the TOTAL context and ALREADY INCLUDES the cached subset (cacheRead+cacheWrite),
 * so the denominator is `inputTokens` — NOT `inputTokens + cacheRead` (that
 * double-counts the cached portion and understates the rate; it bit cache-stats.ts).
 * Returns null when there's no input or no cache figure. Pure, so the formula is
 * locked by a test against the intuitive-but-wrong denominator.
 */
export { cacheHitRate, combineUsage, uncachedInputTokens }
