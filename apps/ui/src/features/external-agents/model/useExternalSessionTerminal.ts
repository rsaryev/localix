import { useEffect } from 'react'
import { useChatStore } from '@/entities/chat/model/store'
import { findSessionInState } from '@/entities/chat/model/findSession'
import { openOwnedExternalSession } from './createSession'

/** URL navigation, restored chats and palette selection all open the same session's agent pane. */
export function useExternalSessionTerminal(sessionId: string | null) {
  const provider = useChatStore(
    (state) => findSessionInState(state, sessionId)?.externalAgentProvider,
  )
  useEffect(() => {
    if (!sessionId || !provider) return
    let active = true
    void openOwnedExternalSession(sessionId, () => active)
    return () => {
      active = false
    }
  }, [sessionId, provider])
}
