import { useCallback } from 'react'
import { toast } from '@/shared/lib/notify'

import { backendClient } from '@/shared/api/client'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { applyServerSession } from './sessionSync'

/**
 * Fork the given session (optionally up to a message) into a fresh chat and
 * navigate into the copy. Shared by the message-level fork action and the
 * session-path breadcrumb so the fork behaviour lives in ONE place.
 */
export function useForkSession(
  activeSessionId: string | null,
  goToSession: (id: string, opts?: { project?: string }) => void,
) {
  return useCallback(
    (messageId?: string) => {
      if (!activeSessionId) return
      void backendClient
        .forkSession(activeSessionId, messageId)
        .then((session) => {
          applyServerSession(session)
          // Navigating into the copy IS the confirmation; a durable "Forked" row would only echo it.
          goToSession(session.id, { project: session.projectId ?? null })
        })
        .catch((err: unknown) =>
          toast.error('Could not fork this conversation', {
            description: errorMessage(err, '') || undefined,
          }),
        )
    },
    [activeSessionId, goToSession],
  )
}
