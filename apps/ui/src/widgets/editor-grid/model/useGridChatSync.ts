import { useLayoutEffect, useRef } from 'react'
import { useGridStore, GLOBAL_SCOPE, groupOfTab, scopeOf } from '@/entities/workspace-grid/model'
import { workspaceOf } from '@/shared/lib/workspaceOf'
import { shownTab } from './workspaceChats'

export interface GridChatSyncOpts {
  /** The session the URL/store currently considers active (the focused chat). */
  activeSessionId: string | null
  /** Title for the active session's chat tab (kept fresh on rename). */
  sessionTitle: string | null
}

type GridChatBridge = Pick<
  ReturnType<typeof useGridStore.getState>,
  | 'items'
  | 'root'
  | 'scopeActiveTab'
  | 'setActiveScope'
  | 'setActiveTab'
  | 'setTabTitle'
  | 'openItem'
  | 'resolveRoleGroup'
>

/**
 * Apply one chat→grid selection without exposing a transient empty scope.
 *
 * Zustand store writes notify external subscribers synchronously. Preparing a
 * new scope in the intuitive `setActiveScope()` → `openItem()` order therefore
 * gives GroupView a valid intermediate state where the target scope is visible
 * but owns no tab, so it briefly renders the workspace EmptyState. Seed the
 * hidden target tab first, then reveal its scope as the final write.
 */
export function syncGridChatSelection(
  grid: GridChatBridge,
  activeSessionId: string | null,
  sessionTitle: string | null,
  seededFor: string | null,
): string | null {
  if (!activeSessionId) {
    grid.setActiveScope(GLOBAL_SCOPE)
    return null
  }

  const id = `chat:${activeSessionId}`
  const title = sessionTitle || 'Chat'
  const workspace = workspaceOf(activeSessionId)
  // A chat tab stamped with a scope that is not its workspace (restored from before sub-sessions
  // shared one, or opened before the session's root was known) would stay hidden in the shared
  // scope, and `useFollowShownChat` would route away from it. Re-opening restamps it.
  const existing = scopeOf(grid.items[id]?.scope) === workspace ? grid.items[id] : undefined
  if (existing) {
    // A restored/session-warm chat is already seeded. Updating it through
    // `openItem` would also activate it, overwriting the persisted active tab
    // (for example a plugin-owned workbench tab) on every reload or session return.
    // Preserve the scope's own active work item and only refresh presentation.
    if (existing.title !== title) grid.setTabTitle(id, title)
    // One exception: the workspace is shared (`workspaceChats.ts`), so the group may be showing a
    // SIBLING conversation's chat. That one gives way; any other tab it shows is kept as above.
    const leaf = groupOfTab(grid.root, id)
    const shown = leaf ? shownTab(leaf, grid, workspace) : null
    if (leaf && shown && shown !== id && grid.items[shown]?.kind === 'chat')
      grid.setActiveTab(leaf.id, id)
  } else if (seededFor !== activeSessionId || grid.items[id]) {
    grid.openItem(
      {
        kind: 'chat' as const,
        id,
        title,
        scope: activeSessionId,
        payload: { sessionId: activeSessionId },
      },
      { group: grid.resolveRoleGroup('chat') },
    )
  }

  // Last write by design: once the target scope becomes visible, its chat tab
  // already exists. The outgoing scope remains paintable throughout preparation.
  grid.setActiveScope(activeSessionId)
  return activeSessionId
}

/**
 * ONE-WAY bridge: the chat store's active session → the editor grid.
 *
 *  - Point the visible-tab filter (`activeScope`) at the active session's
 *    WORKSPACE (its root conversation, `workspaceOf`) so its tabs
 *    (files/preview/git/…) show and other workspaces' hide; a sub-session
 *    changes the chat, not the scope.
 *    With no active session, only GLOBAL tabs are visible (neutral state).
 *  - Seed the active session's `chat:<id>` WorkItem — but ONLY when the active
 *    session actually CHANGES. Explicitly closing a chat tab is handled in
 *    GroupView like any other tab: the session stays in history and this hook
 *    never reopens its tab for an unchanged session. A rename only
 *    refreshes an EXISTING tab's title in place.
 *
 * This hook never writes back into the active session. The one way back is
 * `useFollowShownChat` (`workspaceChats.ts`), and it is bounded by the
 * workspace: the scope filter still hides every OTHER workspace's chat tab, so
 * only a sibling of the same conversation — shown by a click, or by a close that
 * falls back to it — can become the active session.
 */
export function useGridChatSync({ activeSessionId, sessionTitle }: GridChatSyncOpts): void {
  // The session this hook last OPENED a chat tab for. Distinguishes a real
  // session switch (→ open/reveal the chat) from a same-session re-render or
  // title change (→ only refresh the title; never reopen a user-closed chat).
  const seededFor = useRef<string | null>(null)
  // Route changes must replace the chat tab before paint. An ordinary effect
  // leaves the prior session's composer mounted for one frame, so its running
  // state can briefly hide/disable the new session's model picker.
  useLayoutEffect(() => {
    // The launch's own selection opens its chat like any other: a window always starts in a chat.
    seededFor.current = syncGridChatSelection(
      useGridStore.getState(),
      activeSessionId,
      sessionTitle,
      seededFor.current,
    )
  }, [activeSessionId, sessionTitle])
}
