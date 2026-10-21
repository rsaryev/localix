import type { UiSession } from '@/shared/api/contracts'
import { sessionRoute } from '@/shared/api/contracts'
import { composerDrafts } from '@/shared/lib/composerDrafts'
import { isEmptyDraftSession } from './sessionListHelpers'
import type { ResolvedConversationStart } from './conversationStartStrategy'

const MAX_OWNED_DRAFTS = 32
const MAX_DRAFT_AGE_MS = 24 * 60 * 60 * 1000

/** Reuse only fresh, untouched chats created by THIS workspace's creation lane. */
export function createNewChatDrafts(now: () => number = Date.now) {
  const owned = new Map<string, { bornAt: number; requestedProjectId: string | null }>()
  return {
    remember(session: UiSession, requestedProjectId: string | null): void {
      owned.set(session.id, { bornAt: now(), requestedProjectId })
      while (owned.size > MAX_OWNED_DRAFTS) owned.delete(owned.keys().next().value!)
    },
    forget(id: string): void {
      owned.delete(id)
    },
    find(
      sessions: readonly UiSession[],
      activeId: string | null,
      plan: Pick<ResolvedConversationStart, 'projectId' | 'agentId'>,
    ): UiSession | undefined {
      const candidates = sessions.filter((session) => {
        const entry = owned.get(session.id)
        if (!entry) return false
        if (now() - entry.bornAt > MAX_DRAFT_AGE_MS || !isEmptyDraftSession(session)) {
          owned.delete(session.id)
          return false
        }
        const sameScope =
          session.projectId === plan.projectId ||
          (plan.projectId === null && entry.requestedProjectId === null)
        return (
          sameScope &&
          session.agents.length === 1 &&
          sessionRoute(session).agentId === plan.agentId &&
          composerDrafts.get(session.id) === ''
        )
      })
      return candidates.find((session) => session.id === activeId) ?? candidates[0]
    },
  }
}
