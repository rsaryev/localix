import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { copyText } from '@localixai/mini-app-sdk/ui/interactions'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

import { runUiCommand } from '@/shared/contrib/uiCommands'
import { openSessionSwitcher } from '@/shared/lib/chatChromeBus'
import { inspector } from '@/shared/lib/inspectorBus'
import { CMD } from '@/shared/lib/keybindings/command-ids'
import { toast } from '@/shared/lib/notify'
import { navigateSettings } from '@/shared/lib/settingsNavBus'

import { describeContextUsage } from '../../model/contextUsageSummary'
import { buildUsageIndicatorView, type ContextUsageInput } from '../../model/contextUsageView'
import { findSessionInState } from '../../model/findSession'
import { useChatStore } from '../../model/store'
import { usePermissionMode } from '../../model/usePermissionMode'
import { RollbackConfirmDialog } from '../RollbackConfirmDialog'
import { replyText } from './clientCommandRows'
import { runClientCommand, type ClientCommandActions } from './clientCommands'

export interface ClientCommandsInput {
  /** The composer's own chat: what these commands act on. */
  sessionId: string | null
  setPrompt: (value: string) => void
  /** The composer's send, for the task of `/plan <task>`. */
  onSend: (text: string) => void
  /** The chat surface's rollback; a surface without one cannot `/rewind`. */
  onRollback?: (messageId: string) => void
  /** Open a chat the way `/open` does. */
  openChat: (chatId: string) => void
  /** What the context gauge is built from. */
  context: ContextUsageInput
}

const messagesOf = (sessionId: string | null) =>
  findSessionInState(useChatStore.getState(), sessionId)?.messages ?? []

/**
 * Claude Code's habitual commands in one composer, as wrappers over what the app already does:
 * the new-chat command and the chat picker, `renameSession`, the message menu's rollback and its
 * question, the permission-mode control, Settings navigation and the Copy text action. Returns
 * `submit` for the composer's Enter and the confirmation `/rewind` asks, to render beside it.
 */
export function useClientCommands(input: ClientCommandsInput) {
  const { sessionId, setPrompt, onSend, onRollback, openChat, context } = input
  const [rewinding, setRewinding] = useState<string | null>(null)
  const permission = usePermissionMode(sessionId)
  const { setMode } = permission
  const { editable, mode } = permission

  const planMode = useCallback(
    async (task: string) => {
      if (!sessionId) return toast.message('Open a conversation first')
      if (!editable)
        return toast.message('This conversation runs in the mode of the one that started it')
      if (mode !== 'plan' && !(await setMode('plan'))) return
      if (task) onSend(task)
    },
    [sessionId, editable, mode, setMode, onSend],
  )

  const actions = useMemo<ClientCommandActions>(
    () => ({
      // The app's own new-chat command: the rail's +, the chord and the palette run it too.
      newChat: () => runUiCommand(CMD.newChat, true),
      resumeChat: (chatId) => (chatId ? openChat(chatId) : openSessionSwitcher()),
      renameChat: (title) => {
        if (!sessionId) return toast.message('Open a conversation first')
        void useChatStore
          .getState()
          .renameSession(sessionId, title)
          .catch((error: unknown) =>
            toast.error('Could not rename this conversation', {
              description: errorMessage(error, '') || undefined,
            }),
          )
      },
      rewind: (messageId) => {
        if (!onRollback || !sessionId) return false
        setRewinding(messageId)
        return true
      },
      planMode: (task) => void planMode(task),
      showContext: () => {
        const { title, detail } = describeContextUsage(buildUsageIndicatorView(context))
        toast.message(title, { description: detail })
      },
      copyReply: (n) => {
        const text = replyText(messagesOf(sessionId), n)
        if (!text) return toast.message(n === 1 ? 'No reply to copy yet' : `No reply number ${n}`)
        void copyText(text, 'Reply').then((copied) => copied && toast.message('Reply copied'))
      },
      // Open first, then navigate: the panel applies a latched target when it mounts.
      openSettings: (tab) => {
        inspector.openSettings()
        navigateSettings(tab)
      },
      usage: (message) => toast.message(message),
    }),
    [sessionId, onRollback, openChat, planMode, context],
  )

  const submit = useCallback(
    (detected: { command: { id: string }; text: string } | null): boolean => {
      if (!runClientCommand(detected, actions)) return false
      // Cleared before anything runs: a rollback writes the rolled-back text back into the draft.
      setPrompt('')
      return true
    },
    [actions, setPrompt],
  )

  const confirmation: ReactNode = (
    <RollbackConfirmDialog
      open={rewinding !== null}
      onConfirm={() => {
        if (rewinding) onRollback?.(rewinding)
        setRewinding(null)
      }}
      onClose={() => setRewinding(null)}
    />
  )
  return { submit, confirmation }
}
