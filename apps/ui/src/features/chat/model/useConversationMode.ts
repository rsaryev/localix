import { useCallback } from 'react'

import { backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'
import type { ConversationMode } from '@localixai/api/conversation-modes'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

import { findSessionInState } from './findSession'
import { useChatStore } from './store'

/**
 * The composer's view of its conversation's mode — solo or group — and the one way to change it.
 *
 * Only a chat has one: a delegated child or a job is its one agent's task, and the server refuses
 * a mode there, so the control is not offered. Solo is exactly one agent, so it cannot be chosen
 * while several are seated (`canBeSolo`); the person removes the others first, and nobody is
 * dropped behind their back.
 */
export function useConversationMode(sessionId: string | null) {
  const mode = useChatStore(
    (state) => findSessionInState(state, sessionId)?.conversationMode ?? 'group',
  )
  const editable = useChatStore((state) => {
    const session = findSessionInState(state, sessionId)
    return Boolean(session) && session?.sessionKind === 'chat' && !session.closedAt
  })
  const canBeSolo = useChatStore(
    (state) => (findSessionInState(state, sessionId)?.agents.length ?? 0) <= 1,
  )

  const setMode = useCallback(
    (conversationMode: ConversationMode) => {
      if (!sessionId) return
      void backendClient
        .updateSession(sessionId, { conversationMode })
        .then((updated) => useChatStore.getState()._replaceSession(updated))
        .catch((err: unknown) =>
          toast.error('Could not change the conversation mode', {
            description: errorMessage(err, '') || undefined,
          }),
        )
    },
    [sessionId],
  )

  return { mode, editable, canBeSolo, setMode }
}
