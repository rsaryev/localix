/**
 * The chats of ONE workspace: a conversation and its sub-sessions, each a chat tab in the same
 * scope (`workspaceOf`), side by side in the chat group.
 *
 * With one chat tab per scope, the active session and the chat on screen could not disagree: the
 * scope filter hid every other chat. Sharing a scope ends that, so the two directions are kept
 * in step here:
 *   - the active session → its tab is the one shown (`shownTab`, used by `syncGridChatSelection`);
 *   - the tab shown → the active session (`useFollowShownChat`): picking a sibling's chat tab, or
 *     closing the shown one so its group falls back to another, navigates there like the sidebar.
 */
import { useEffect, useEffectEvent } from 'react'
import {
  groupViewModel,
  leaves,
  useGridStore,
  type GridStore,
  type LeafNode,
} from '@/entities/workspace-grid/model'
import { workspaceOf } from '@/shared/lib/workspaceOf'

type ShownState = Pick<GridStore, 'items' | 'scopeActiveTab'>

/** The tab a group shows while `scope` is on screen — the same pick the group renders. */
export const shownTab = (leaf: LeafNode, state: ShownState, scope: string): string | null =>
  groupViewModel(leaf, state.items, scope, [], state.scopeActiveTab).visibleActive

const chatSessionOf = (state: ShownState, tabId: string | null): string | null => {
  const item = tabId ? state.items[tabId] : undefined
  const sessionId = item?.kind === 'chat' ? item.payload?.sessionId : undefined
  return typeof sessionId === 'string' ? sessionId : null
}

/** The sessions whose chat is on screen, the focused group's first. */
export function shownChatSessions(state: GridStore): string[] {
  const ordered = [...leaves(state.root)].sort(
    (a, b) => Number(b.id === state.activeGroup) - Number(a.id === state.activeGroup),
  )
  return ordered.flatMap((leaf) => {
    const sessionId = chatSessionOf(state, shownTab(leaf, state, state.activeScope))
    return sessionId ? [sessionId] : []
  })
}

/**
 * Follow the chat on screen with the active session. Only a change of WHICH chats are shown acts
 * (any other grid write — a Browser reveal, a split — leaves them as they were), and only once the
 * grid shows the active session's workspace: between a navigation and the layout effect that
 * catches the grid up, the old chat is still on screen and must not pull the route back.
 */
export function followShownChat(
  activeSession: () => string | null,
  goToSession: (id: string) => void,
): () => void {
  let shown = shownChatSessions(useGridStore.getState()).join('\n')
  return useGridStore.subscribe((state) => {
    const next = shownChatSessions(state)
    const key = next.join('\n')
    if (key === shown) return
    shown = key
    const current = activeSession()
    if (!current || next.length === 0 || next.includes(current)) return
    if (state.activeScope !== workspaceOf(current)) return
    goToSession(next[0]!)
  })
}

export function useFollowShownChat(
  activeSessionId: string | null,
  goToSession: (id: string) => void,
): void {
  // Read at call time, so the subscription itself is made once.
  const activeNow = useEffectEvent(() => activeSessionId)
  const goNow = useEffectEvent((id: string) => goToSession(id))
  useEffect(
    () =>
      followShownChat(
        () => activeNow(),
        (id) => goNow(id),
      ),
    [],
  )
}
