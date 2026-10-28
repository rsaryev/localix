import { useCallback, useMemo, useState } from 'react'
import { toast } from '@/shared/lib/notify'
import type { UiSession } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import {
  downloadTextFile,
  exportFileName,
  exportableTurns,
  sessionToMarkdown,
} from '@/shared/lib/chatExport'
import { useChatStore } from '../model/store'

/** Rename and export behaviour for one sidebar session row. */
export function useSessionRowActions(session: UiSession, title: string) {
  const renameSession = useChatStore((s) => s.renameSession)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(title)
  // A sidebar row acts on ITS conversation, which is often not the one on screen: the row names
  // it so the Event Center links back to the right chat rather than the open one.
  const origin = useMemo(
    () => ({
      kind: 'session' as const,
      sessionId: session.id,
      projectId: session.projectId ?? null,
    }),
    [session.id, session.projectId],
  )

  // Export the full conversation to a Markdown file. Fetches the session fresh so
  // an unopened sidebar row (whose messages aren't in the store) exports completely.
  // `redacted` = the privacy-safe variant (payloads → typed placeholders).
  const handleExport = useCallback(
    async (redacted = false) => {
      try {
        const full = await backendClient.getSession(session.id)
        if (exportableTurns(full.messages, { redacted }).length === 0) {
          toast.info('Nothing to export yet', {
            description: 'This conversation has no messages to write out.',
            origin,
          })
          return
        }
        const md = sessionToMarkdown(full, { redacted })
        downloadTextFile(exportFileName(full.title, redacted ? 'redacted' : undefined), md)
      } catch (e) {
        toast.error('Could not export this conversation', {
          description: errorMessage(e, '') || undefined,
          origin,
        })
      }
    },
    [session.id, origin],
  )

  // A new title (a rename landing from elsewhere) replaces the draft, while rendering.
  const [draftTitle, setDraftTitle] = useState(title)
  if (draftTitle !== title) {
    setDraftTitle(title)
    setRenameValue(title)
  }

  const handleSaveRename = () => {
    if (renameValue.trim() && renameValue.trim() !== title) {
      renameSession(session.id, renameValue.trim()).catch((e) => {
        toast.error('Could not rename this conversation', {
          description: errorMessage(e, '') || undefined,
          origin,
        })
      })
    }
    setIsRenaming(false)
  }

  const handleCancelRename = () => {
    setRenameValue(title)
    setIsRenaming(false)
  }

  return {
    isRenaming,
    setIsRenaming,
    renameValue,
    setRenameValue,
    handleExport,
    handleSaveRename,
    handleCancelRename,
  }
}
