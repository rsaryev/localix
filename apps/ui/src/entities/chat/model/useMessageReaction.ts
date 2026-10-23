/**
 * Toggling the person's own mark on one message.
 *
 * A hook rather than three lines in the card because it states the one rule worth stating: the
 * chip is NOT painted optimistically. The server answers with the stored row on the stream, so a
 * guessed chip cannot disagree with the authoritative row that arrives a beat later.
 */
import { useCallback } from 'react'

import { backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

export function useMessageReaction(sessionId: string | null, messageId: string) {
  return useCallback(
    (emoji: string) => {
      if (!sessionId) return
      void backendClient.reactToMessage(sessionId, messageId, emoji).catch((error: unknown) =>
        toast.error('Could not react to this message', {
          description: errorMessage(error, '') || undefined,
        }),
      )
    },
    [sessionId, messageId],
  )
}
