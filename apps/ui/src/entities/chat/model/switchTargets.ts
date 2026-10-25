import type { UiSession } from '@/shared/api/contracts'

/**
 * The chats a person can jump to: top-level conversations that are not archived. Sub-agents,
 * jobs and threads are reached from their parent, not from a list of chats. The session switcher
 * and `/resume` offer the same set.
 */
export function isSwitchTarget(session: UiSession): boolean {
  return session.sessionKind === 'chat' && !session.parentSessionId && !session.isArchived
}
