import {
  accumulateUsage,
  createUsageAccumulator,
  finishUsageAccumulator,
  hasRecordedUsage,
  replaceUsageInSummary,
  type UsageAccumulator,
} from './usage-summary'
import type { ChatUsagePayload } from './chat-stream-types'

interface UsageMessage {
  role: string
  from?: string
  usage?: ChatUsagePayload
}

/** Authorship wins over provider metadata; never assign legacy unknown usage to a roster member. */
function usageAgent(message: UsageMessage | undefined): string | undefined {
  if (message?.role !== 'assistant') return undefined
  if (message.from?.startsWith('agent:')) return message.from.slice('agent:'.length) || undefined
  return undefined
}

/** Whole-history totals independent of the current roster, including participants who left. */
export function summarizeParticipantUsage(
  messages: readonly UsageMessage[],
): Record<string, ChatUsagePayload> {
  const grouped = new Map<string, UsageAccumulator>()
  for (const message of messages) {
    const agentId = usageAgent(message)
    if (!agentId || !hasRecordedUsage(message.usage)) continue
    const accumulator = grouped.get(agentId) ?? createUsageAccumulator()
    accumulateUsage(accumulator, message.usage)
    grouped.set(agentId, accumulator)
  }
  return Object.fromEntries(
    [...grouped].map(([id, values]) => [id, finishUsageAccumulator(values)!]),
  )
}

/** Replace just one message's contribution so windowed clients keep their historical totals. */
export function replaceParticipantUsage(
  summary: Record<string, ChatUsagePayload> | undefined,
  previous: UsageMessage | undefined,
  next: UsageMessage | undefined,
): Record<string, ChatUsagePayload> | undefined {
  if (previous?.usage === next?.usage && usageAgent(previous) === usageAgent(next)) return summary
  if (!hasRecordedUsage(previous?.usage) && !hasRecordedUsage(next?.usage)) return summary
  const before = usageAgent(previous)
  const after = usageAgent(next)
  if (!before && !after) return summary
  const result = { ...summary }
  for (const agentId of new Set([before, after])) {
    if (!agentId) continue
    const usage = replaceUsageInSummary(
      result[agentId],
      before === agentId ? previous?.usage : undefined,
      after === agentId ? next?.usage : undefined,
    )
    if (usage) result[agentId] = usage
    else delete result[agentId]
  }
  return result
}
