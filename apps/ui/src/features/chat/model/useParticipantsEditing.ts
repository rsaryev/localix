/**
 * Changing who is in a conversation, from the composer.
 *
 * ONE verb, in both directions. Adding and removing both send the WHOLE participant list, which
 * is what the server reseats from — an add/remove verb can half-apply, and a participant list
 * that half applied is a conversation with someone in it that nobody chose. The two callbacks here differ
 * only in the list they compute.
 *
 * Lives beside the store rather than in the composer because it is session state being edited,
 * not composer state: the same edit arrives from the roster strip, the picker's menu, and
 * anything later that wants it.
 */
import { useCallback } from 'react'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

import { backendClient } from '@/shared/api/client'
import type { SessionAgentRoute } from '@/shared/api/contracts'
import { useChatStore } from './store'

export function useParticipantsEditing(
  sessionId: string | null,
  participants: readonly SessionAgentRoute[],
) {
  const reseat = useCallback(
    (agentIds: string[]) => {
      if (!sessionId) return
      // The list was built from what this client last saw; the server refuses it if the
      // conversation changed since (an agent invited someone), instead of erasing that change.
      const revision = useChatStore.getState().sessions.find((s) => s.id === sessionId)?.revision
      void backendClient
        .updateSession(sessionId, {
          agentIds,
          ...(revision ? { expectedUpdatedAt: revision } : {}),
        })
        .then((updated) => useChatStore.getState()._replaceSession(updated))
        .catch((err: unknown) =>
          toast.error('Could not update the participants', {
            description: errorMessage(err, '') || undefined,
          }),
        )
    },
    [sessionId],
  )

  const addParticipant = useCallback(
    (agentId: string) => {
      if (participants.some((participant) => participant.agentId === agentId)) return
      // Appended, so speaking order stays join order and nobody already here changes places.
      reseat([...participants.map((participant) => participant.agentId), agentId])
    },
    [participants, reseat],
  )

  const removeParticipant = useCallback(
    (agentId: string) => {
      const remaining = participants.filter((participant) => participant.agentId !== agentId)
      reseat(remaining.map((participant) => participant.agentId))
    },
    [participants, reseat],
  )

  return { addParticipant, removeParticipant }
}
