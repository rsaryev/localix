import type { Message } from '@/shared/api/contracts'
import { contextAttemptFromMessage, contextWindowFromParts } from './contextUsage'
import { buildUsageIndicatorView, type UsageIndicatorView } from './contextUsageView'

/** Only this author's newest attempt; an old success cannot mask a newer failure. */
export function createParticipantContextSelector(agentId: string, contextWindow?: number) {
  let previous: Message | undefined
  let view: UsageIndicatorView | undefined
  return (messages: readonly Message[]): UsageIndicatorView => {
    let message: Message | undefined
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const candidate = messages[index]
      if (candidate?.role === 'assistant' && candidate.from === `agent:${agentId}`) {
        message = candidate
        break
      }
    }
    // Text-only streaming keeps the same metadata: no recalculation or tooltip re-render.
    if (
      view &&
      previous?.id === message?.id &&
      previous?.usage === message?.usage &&
      previous?.dataParts === message?.dataParts
    )
      return view
    previous = message
    view = buildUsageIndicatorView({
      latestAttempt: message ? contextAttemptFromMessage(message) : undefined,
      contextDiagnostics: contextWindowFromParts(message?.dataParts),
      contextWindow,
    })
    return view
  }
}
