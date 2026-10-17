/**
 * The conversation's participants, so an `@handle` in the text becomes a link to that agent.
 *
 * Read as a joined KEY and split under memo: the store hands out a fresh array reference on
 * every session patch, and an unstable prop here would re-parse every message's markdown per
 * patch. A one-to-one has no colleague to address, so it links nothing.
 */
import { useMemo } from 'react'
import { conversationMentionHandles } from '@localixai/api/agent-mentions'
import { isMultiParticipant } from '@/shared/api/contracts'
import { findSessionInState } from './findSession'
import { useChatStore } from './store'

export function useConversationMentionHandles(
  sessionId: string | null | undefined,
): readonly string[] | undefined {
  const mentionKey = useChatStore((s) => {
    const agents = sessionId ? findSessionInState(s, sessionId)?.agents : undefined
    if (!sessionId) return ''
    return agents && isMultiParticipant({ agents })
      ? conversationMentionHandles(agents.map((a) => a.handle)).join('\u0000')
      : ''
  })
  return useMemo(() => (mentionKey ? mentionKey.split('\u0000') : undefined), [mentionKey])
}
