import { useCallback } from 'react'

import type { SessionAgentRoute, SessionQueueItem } from '@/shared/api/contracts'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

import { findSessionInState } from '../../model/findSession'
import { persistPinnedSkills } from '../../model/pinnedSkillMutations'
import { useChatStore } from '../../model/store'
import { useParticipantsEditing } from '../../model/useParticipantsEditing'

const EMPTY_SKILLS: string[] = []
/**
 * Stable identity: a fresh literal would re-render the memoized picker on every keystroke. The
 * whole route, not just the identity: the picker draws a row per participant showing what that
 * participant runs on, and the server has already resolved it through the model chain.
 */
const NO_PARTICIPANTS: readonly SessionAgentRoute[] = []

/**
 * What the composer reads off ITS session in the chat store. Read here rather than passed
 * down: the composer already knows which session it is for, so threading these through the
 * surface would only add props that can disagree with the store.
 */
export function usePromptSessionView(
  activeSessionId: string | null,
  serverQueue: SessionQueueItem[] | undefined,
) {
  // Silent while a decision is pending. A rotating product tip directly above a card asking
  // the user to approve `rm -rf` competes with it for the one thing that matters at that
  // moment, and it is the half that can wait.
  const awaitingAnswer = useChatStore((state) =>
    Boolean(findSessionInState(state, activeSessionId)?.pendingInteraction),
  )
  const pinnedSkills =
    useChatStore((state) => findSessionInState(state, activeSessionId)?.pinnedSkills) ??
    EMPTY_SKILLS
  const activeProjectId =
    useChatStore((state) => findSessionInState(state, activeSessionId)?.projectId) ?? null
  // The participants this composer writes to: the picker offers a row per participant so a
  // model can be chosen for each of them separately.
  const participants =
    useChatStore((state) => findSessionInState(state, activeSessionId)?.agents) ?? NO_PARTICIPANTS

  const activeAgentId =
    useChatStore((state) => findSessionInState(state, activeSessionId)?.activeAgentId) ?? null
  const conversationFloor = {
    speaking: activeAgentId,
    waiting: (serverQueue ?? []).flatMap((item) => (item.agentId ? [item.agentId] : [])),
  }

  const participantsEditing = useParticipantsEditing(activeSessionId, participants)

  const setSkills = useCallback(
    (names: string[]) => {
      if (!activeSessionId) return
      // The stored pins come back as `session.updated` on the stream.
      void persistPinnedSkills(activeSessionId, names, activeProjectId).catch((err: unknown) =>
        toast.error('Could not update the pinned skills', {
          description: errorMessage(err, '') || undefined,
        }),
      )
    },
    [activeProjectId, activeSessionId],
  )

  return {
    awaitingAnswer,
    pinnedSkills,
    activeProjectId,
    participants,
    conversationFloor,
    participantsEditing,
    setSkills,
  }
}
