import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import {
  initialEditState,
  enterEdit,
  cancelEdit as cancelEditState,
  confirmEdit as confirmEditState,
  shouldPersistEdit,
  type EditState,
  type EditingMessage,
} from '@/entities/chat/model/messageEdit'

export interface MessageEditDeps {
  activeSessionId: string | null
  /** Live composer draft (read to stash it when editing begins). */
  prompt: string
  setPrompt: Dispatch<SetStateAction<string>>
  /**
   * The existing update-message handler (forks a branch from the edited message
   * and re-syncs). Reused verbatim — editing only moves WHERE you type, not how
   * the edit is persisted.
   */
  editMessage: (messageId: string, content: string) => void
}

export interface MessageEdit {
  /** The message currently loaded into the composer for editing (drives the banner). */
  editing: EditingMessage | null
  /** Begin editing: stash the draft, load the message text into the composer, focus. */
  beginEdit: (messageId: string, content: string) => void
  /** Cancel (× / Esc): restore the stashed draft. */
  cancelEdit: () => void
  /**
   * Submit while editing: persist the change if non-empty & changed (else just
   * cancel), then restore the stashed draft. Returns true when it handled the
   * submit (so the composer skips the normal send path).
   */
  submitEdit: (text: string) => boolean
}

/**
 * Composer-based message editing orchestration. Backed by the pure
 * {@link enterEdit}/{@link cancelEdit}/{@link confirmEdit} reducer; this hook binds
 * it to the composer's draft (stash/restore) and the existing update-message call.
 * Co-located in the chat-workspace widget alongside useSendMessage/useMessageActions.
 */
export function useMessageEdit({
  activeSessionId,
  prompt,
  setPrompt,
  editMessage,
}: MessageEditDeps): MessageEdit {
  const [state, setState] = useState<EditState>(initialEditState)

  // Read the live draft without re-creating beginEdit on every keystroke.
  const promptRef = useRef(prompt)
  // eslint-disable-next-line react-hooks/refs
  promptRef.current = prompt
  const stateRef = useRef(state)
  // eslint-disable-next-line react-hooks/refs
  stateRef.current = state

  // Switching sessions abandons an in-flight edit: the composer swaps to the new
  // session's draft (ChatSurface's own effect), so a lingering banner would point
  // at a message from the chat you just left. Clear silently (no draft restore —
  // the session-switch effect owns the incoming draft).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(initialEditState)
  }, [activeSessionId])

  const beginEdit = useCallback(
    (messageId: string, content: string) => {
      if (!activeSessionId) return
      const t = enterEdit(stateRef.current, {
        sessionId: activeSessionId,
        messageId,
        originalText: content,
        currentDraft: promptRef.current,
      })
      setState(t.state)
      setPrompt(t.composerText)
      // Focus the composer so the user can type immediately.
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLTextAreaElement>('[data-focus-part="chat"] textarea')
        if (el) {
          el.focus()
          const end = el.value.length
          el.setSelectionRange(end, end)
        }
      })
    },
    [activeSessionId, setPrompt],
  )

  const cancelEdit = useCallback(() => {
    if (!stateRef.current.editing) return
    const t = cancelEditState(stateRef.current)
    setState(t.state)
    setPrompt(t.composerText)
  }, [setPrompt])

  const submitEdit = useCallback(
    (text: string): boolean => {
      const editing = stateRef.current.editing
      if (!editing) return false
      if (shouldPersistEdit(editing, text)) {
        editMessage(editing.messageId, text.trim())
      }
      const t = confirmEditState(stateRef.current)
      setState(t.state)
      setPrompt(t.composerText)
      return true
    },
    [editMessage, setPrompt],
  )

  return { editing: state.editing, beginEdit, cancelEdit, submitEdit }
}
