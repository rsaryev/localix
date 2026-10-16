import type { MessageBinding } from '@/shared/api/contracts'
import { pluginCommandActivity } from './pluginCommandActivity'
import type { Message } from './types'

// Disambiguates placeholder ids minted within the same millisecond.
let optimisticSeq = 0

// One mint for every optimistic paint (plain send AND edit-resend) so the id
// scheme and echo-claim contract can never drift between entry points.
export function makeOptimisticPair(
  text: string,
  bindings?: MessageBinding[],
  internal?: boolean,
): { user: Message; assistant: Message } {
  optimisticSeq += 1
  const stamp = `${Date.now()}-${optimisticSeq}`
  const user: Message = {
    id: `optimistic-user-${stamp}`,
    role: 'user' as const,
    content: text,
    bindings,
    optimistic: true,
    // A hidden (machine-composed) send: flag the optimistic row the same way the server's
    // echo will be flagged, so the transcript filter hides it from the very first frame.
    ...(internal ? { isInternal: true } : {}),
    createdAt: new Date().toISOString(),
  }
  const commandActivity = internal ? null : pluginCommandActivity(text)
  const assistant: Message = commandActivity
    ? {
        id: `optimistic-assistant-${stamp}`,
        role: 'system' as const,
        commandOutput: {
          // `pluginCommandActivity` only recognizes `/plugin <action>`.
          command: '/plugin',
          tone: 'neutral',
          text: commandActivity.label,
          activity: commandActivity,
        },
        optimistic: true,
        createdAt: new Date().toISOString(),
      }
    : {
        id: `optimistic-assistant-${stamp}`,
        role: 'assistant' as const,
        items: [],
        optimistic: true,
        createdAt: new Date().toISOString(),
      }
  return { user, assistant }
}
