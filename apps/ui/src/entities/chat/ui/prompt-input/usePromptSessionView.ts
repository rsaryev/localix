import { useCallback } from 'react'

import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

import { findSessionInState } from '../../model/findSession'
import { persistPinnedSkills } from '../../model/pinnedSkillMutations'
import { useChatStore } from '../../model/store'

const EMPTY_SKILLS: string[] = []

/**
 * What the composer reads off ITS session in the chat store. Read here rather than passed
 * down: the composer already knows which session it is for, so threading these through the
 * surface would only add props that can disagree with the store.
 */
export function usePromptSessionView(activeSessionId: string | null) {
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
  // The conversation's agent, whole: the picker draws a row for what it runs on, and the server
  // has already resolved that through the model chain.
  const agent = useChatStore((state) => findSessionInState(state, activeSessionId)?.agent) ?? null

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
    agent,
    setSkills,
  }
}
