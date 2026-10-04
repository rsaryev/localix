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
import type { PermissionMode } from '../../capabilities/permission-modes'
import type { SessionRecord } from '../repository'
import { normalizeSessionTitle } from '../session-limits'

export function sessionFieldsPatch(
  session: SessionRecord,
  patch: {
    title?: string
    isPinned?: boolean
    isArchived?: boolean
    projectId?: string
    runtimeStatus?: SessionRecord['runtimeStatus']
    /** Already cleared by the caller against the conversation having started. */
    rosterLocked?: boolean
    /** Already cleared by the caller against the session being a delegated child. */
    permissionMode?: PermissionMode
  },
  now: () => string,
): Partial<SessionRecord> | null {
  const fields: Partial<SessionRecord> = {
    ...(patch.title !== undefined
      ? { title: normalizeSessionTitle(patch.title, session.title) }
      : {}),
    ...(patch.isPinned !== undefined ? { isPinned: patch.isPinned } : {}),
    ...(patch.isArchived !== undefined
      ? { archivedAt: patch.isArchived ? (session.archivedAt ?? now()) : null }
      : {}),
    ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
    ...(patch.runtimeStatus !== undefined ? { runtimeStatus: patch.runtimeStatus } : {}),
    ...(patch.rosterLocked !== undefined ? { rosterLocked: patch.rosterLocked } : {}),
    ...(patch.permissionMode !== undefined ? { permissionMode: patch.permissionMode } : {}),
  }
  return Object.keys(fields).length > 0 ? { ...fields, updatedAt: now() } : null
}
