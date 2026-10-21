/**
 * WHAT A PATCH CHANGES ABOUT A SESSION'S OWN FIELDS — and nothing else.
 *
 * The result carries ONLY the fields the patch names. It used to be the whole session record
 * with the patch spread over it, and the repository writes every field it is handed: a rename
 * read the session, then wrote its stale `runtimeStatus` back over a run that had started in
 * between. An absent key is "leave it", never "set it to what I read".
 *
 * Membership and routes are not here: WHO is in the conversation goes through the one
 * participants writer (`runtime/conversation-participants.ts`), and what one of them runs on is
 * its own write. Archiving keeps the FIRST archive time rather than restamping it on every toggle.
 */
import type { PermissionMode } from '../../../contracts/permission-modes'
import type { SessionRecord } from '../repository'
import { normalizeSessionTitle } from '../session-limits'

export function sessionFieldsPatch(
  session: SessionRecord,
  patch: {
    externalAgentProvider?: string
    externalAgentSessionKey?: string
    title?: string
    goal?: string | null
    previousTopicSummary?: string | null
    isPinned?: boolean
    isArchived?: boolean
    projectId?: string
    runtimeStatus?: SessionRecord['runtimeStatus']
    /** Already cleared by the caller against the session being a delegated child. */
    permissionMode?: PermissionMode
  },
  now: () => string,
): Partial<SessionRecord> | null {
  const fields: Partial<SessionRecord> = {
    ...(patch.externalAgentProvider !== undefined
      ? { externalAgentProvider: patch.externalAgentProvider }
      : {}),
    ...(patch.title !== undefined
      ? { title: normalizeSessionTitle(patch.title, session.title) }
      : {}),
    ...(patch.goal !== undefined ? { goal: patch.goal } : {}),
    ...(patch.previousTopicSummary !== undefined
      ? { previousTopicSummary: patch.previousTopicSummary }
      : {}),
    ...(patch.isPinned !== undefined ? { isPinned: patch.isPinned } : {}),
    ...(patch.isArchived !== undefined
      ? { archivedAt: patch.isArchived ? (session.archivedAt ?? now()) : null }
      : {}),
    ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
    ...(patch.runtimeStatus !== undefined ? { runtimeStatus: patch.runtimeStatus } : {}),
    ...(patch.permissionMode !== undefined ? { permissionMode: patch.permissionMode } : {}),
  }
  // Correlating or reopening a CLI only records identity; it is not conversation activity.
  const identity =
    patch.externalAgentSessionKey !== undefined
      ? { externalAgentSessionKey: patch.externalAgentSessionKey }
      : {}
  if (Object.keys(fields).length > 0) return { ...fields, ...identity, updatedAt: now() }
  return Object.keys(identity).length > 0 ? identity : null
}
