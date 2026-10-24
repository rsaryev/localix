import { useCallback, useState } from 'react'

/**
 * The roster participant whose model the composer shows. Defaults to the first seat, the
 * highest-priority one; a pick that has left the roster, or was made in another session, falls
 * back to it too.
 */
export function useShownParticipant(
  sessionId: string | null,
  participants: readonly { agentId: string }[],
): { shownAgentId: string | null; select: (agentId: string) => void } {
  const [selected, setSelected] = useState<{ sessionId: string | null; agentId: string }>()
  const select = useCallback((agentId: string) => setSelected({ sessionId, agentId }), [sessionId])
  const picked = selected?.sessionId === sessionId ? selected.agentId : undefined
  const shownAgentId =
    participants.find((member) => member.agentId === picked)?.agentId ??
    participants[0]?.agentId ??
    null
  return { shownAgentId, select }
}
