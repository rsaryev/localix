import { useCallback } from 'react'
import type { UiSession } from '@/shared/api/contracts'

/**
 * What the multi-select bar does — one hook, because these five verbs share one rule.
 *
 * Every one of them CONVERGES a mixed selection instead of flipping each row: pin a selection
 * where three of five are pinned and all five end up pinned, not two pinned and three not.
 * Toggling row by row is the obvious implementation and the wrong one — the bar's button says
 * "Pin", and a button that sometimes unpins half of what you chose is lying.
 *
 * Each clears the selection afterwards: the rows the bar was about have just changed, and
 * leaving them selected invites a second press against a state that no longer holds.
 */
export interface SessionBatchDeps {
  selected: readonly UiSession[]
  clear: () => void
  toggleArchiveSession: (id: string) => Promise<void> | void
  togglePinSession: (id: string) => Promise<void> | void
  toggleUnreadSession: (id: string) => void
  moveSessionToProject: (id: string, projectId: string | null) => Promise<void> | void
  onDelete: (id: string) => void
}

export interface SessionBatchActions {
  archive: () => void
  pin: () => void
  unread: () => void
  moveToProject: (projectId: string | null) => void
  remove: () => void
}

export function useSessionBatchActions({
  selected,
  clear,
  toggleArchiveSession,
  togglePinSession,
  toggleUnreadSession,
  moveSessionToProject,
  onDelete,
}: SessionBatchDeps): SessionBatchActions {
  const archive = useCallback(() => {
    const allArchived = selected.every((s) => s.isArchived)
    for (const s of selected) {
      if (Boolean(s.isArchived) !== !allArchived) void toggleArchiveSession(s.id)
    }
    clear()
  }, [selected, toggleArchiveSession, clear])

  const pin = useCallback(() => {
    const allPinned = selected.every((s) => s.isPinned)
    for (const s of selected) {
      if (Boolean(s.isPinned) !== !allPinned) void togglePinSession(s.id)
    }
    clear()
  }, [selected, togglePinSession, clear])

  const unread = useCallback(() => {
    // Any unread → mark all read; otherwise → mark all unread.
    const anyUnread = selected.some((s) => s.isUnread)
    for (const s of selected) {
      if (Boolean(s.isUnread) === anyUnread) toggleUnreadSession(s.id)
    }
    clear()
  }, [selected, toggleUnreadSession, clear])

  const moveToProject = useCallback(
    (projectId: string | null) => {
      // Only reassign rows that are not already there. A moved chat leaves the current scope
      // view on its own, because its projectId stops matching.
      for (const s of selected) {
        if ((s.projectId ?? null) !== projectId) void moveSessionToProject(s.id, projectId)
      }
      clear()
    },
    [selected, moveSessionToProject, clear],
  )

  const remove = useCallback(() => {
    for (const s of selected) onDelete(s.id)
    clear()
  }, [selected, onDelete, clear])

  return { archive, pin, unread, moveToProject, remove }
}
