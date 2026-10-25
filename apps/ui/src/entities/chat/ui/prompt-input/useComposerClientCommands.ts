import { useCallback, useMemo } from 'react'

import type { ContextUsageInput } from '../../model/contextUsageView'
import { useClientCommands } from './useClientCommands'
import { useComposerNavigation } from './useOpenResourceCommand'

/** `useClientCommands` as the composer wires it: chats open through its own navigation host. */
export function useComposerClientCommands(
  input: {
    sessionId: string | null
    setPrompt: (value: string) => void
    onSend: (text: string) => void
    onRollback?: (messageId: string) => void
  } & ContextUsageInput,
) {
  const { sessionId, setPrompt, onSend, onRollback } = input
  const { usage, latestAttempt, contextDiagnostics, contextWindow } = input
  const navigation = useComposerNavigation(sessionId)
  const openChat = useCallback(
    (chatId: string) => navigation.open({ kind: 'session', sessionId: chatId }),
    [navigation],
  )
  const context = useMemo(
    () => ({ usage, latestAttempt, contextDiagnostics, contextWindow }),
    [usage, latestAttempt, contextDiagnostics, contextWindow],
  )
  return useClientCommands({ sessionId, setPrompt, onSend, onRollback, openChat, context })
}
