/**
 * The conversation's participants, so an `@handle` in the text becomes a link to that agent.
 *
 * Read as a joined KEY and split under memo: the store hands out a fresh array reference on
 * every session patch, and an unstable prop here would re-parse every message's markdown per
 * patch. A one-to-one has one participant and nothing to address, so it passes nothing.
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
    // The person is one of the addresses (`conversationMentionHandles`): a participant that hands
    // the turn back writes `@user`, and that has to read as the mark it is rather than as plain
    // text — it is the sentence the conversation stopped on, and the person has to find it while
    // scrolling.
    return agents && isMultiParticipant({ agents })
      ? conversationMentionHandles(agents.map((a) => a.handle)).join('\u0000')
      : ''
  })
  return useMemo(() => (mentionKey ? mentionKey.split('\u0000') : undefined), [mentionKey])
}
