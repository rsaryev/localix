/**
 * Pinning one message: keeping it in the agent's view across context checkpoints.
 *
 * Not painted optimistically, for the reason `useMessageReaction` states: the stored row comes
 * back on the stream, and a guessed mark could disagree with it a beat later.
 */
import { useCallback } from 'react'

import { backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

export function useMessagePin(sessionId: string | null, messageId: string, pinned: boolean) {
  return useCallback(() => {
    if (!sessionId) return
    void backendClient.pinMessage(sessionId, messageId, !pinned).catch((error: unknown) =>
      toast.error(pinned ? 'Could not unpin this message' : 'Could not pin this message', {
        description: errorMessage(error, '') || undefined,
      }),
    )
  }, [sessionId, messageId, pinned])
}
