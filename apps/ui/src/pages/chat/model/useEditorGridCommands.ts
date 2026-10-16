import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'

import {
  adjacentGroupId,
  findLeaf,
  groupViewModel,
  useGridStore,
} from '@/features/workspace-grid/model'
import { focusPart } from '@/shared/lib/focusRing'
import { inspector } from '@/shared/lib/inspectorBus'
import { requireOpenChat } from '@/shared/lib/pageOpenChat'
import { useEditorShortcuts } from './useEditorShortcuts'

interface EditorGridCommandsOptions {
  isMobile: boolean
  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  /** The chat the page has open — what a page-level command acts on; null when none is. */
  openSessionId: string | null
}

export function useEditorGridCommands({
  isMobile,
  setSidebarOpen,
  openSessionId,
}: EditorGridCommandsOptions) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable React state setter
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), [])
  // Editor-grid keyboard surface: ⌘J maximizes/restores the focused group, ⌘`
  // opens a terminal group, ⌘⌥←/→ cycle the focused
  // group's tabs. Reopen-last-closed isn't tracked yet — no-op for now.
  const toggleMaximizeFocused = useCallback(() => {
    const s = useGridStore.getState()
    s.maximizeGroup(s.maximizedGroup ? null : s.activeGroup)
  }, [])
  // Reveal-or-create a terminal via the inspector bus. Deterministic placement
  // docks it in its role group (bottom, or split off the panel when one exists),
  // never the focused chat group. A page shortcut, so it acts on the chat the page
  // has open (passed in) — with none open it says so and opens nothing.
  const openTerminalTab = useCallback(() => {
    const sessionId = requireOpenChat(openSessionId)
    if (sessionId) inspector.openTerminal(sessionId)
  }, [openSessionId])
  const cycleFocusedTab = useCallback((dir: 1 | -1) => {
    const s = useGridStore.getState()
    const leaf = findLeaf(s.root, s.activeGroup)
    if (!leaf) return
    // Cycle only the tabs VISIBLE in this session — never step onto a hidden
    // background-session (or warm) tab that the scope filter excludes.
    const { visibleTabs, visibleActive } = groupViewModel(
      leaf,
      s.items,
      s.activeScope,
      s.warmScopes,
      s.scopeActiveTab,
    )
    if (visibleTabs.length < 2 || !visibleActive) return
    const i = visibleTabs.indexOf(visibleActive)
    s.setActiveTab(leaf.id, visibleTabs[(i + dir + visibleTabs.length) % visibleTabs.length])
  }, [])
  // Move focus between editor groups (⌘⌥↑/↓), "Focus Next/Previous Editor
  // Group". Cycles over the groups VISIBLE in this session (the adaptive view), so
  // it never lands on a group collapsed out of the current scope.
  const focusAdjacentGroup = useCallback((dir: 1 | -1) => {
    const s = useGridStore.getState()
    const id = adjacentGroupId(s, dir)
    if (id) s.setActiveGroup(id)
  }, [])
  // Close the active tab in the focused group (⌘W). Resolve the active tab through
  // the scope-aware view so a hidden background-session tab is never closed.
  const closeFocusedTab = useCallback(() => {
    const s = useGridStore.getState()
    const leaf = findLeaf(s.root, s.activeGroup)
    if (!leaf) return
    const { visibleActive } = groupViewModel(
      leaf,
      s.items,
      s.activeScope,
      s.warmScopes,
      s.scopeActiveTab,
    )
    if (visibleActive) s.closeTab(leaf.id, visibleActive)
  }, [])
  // Reopen the most-recently closed tab where it was (⌘⇧T).
  const reopenClosedTab = useCallback(() => {
    useGridStore.getState().reopenClosedTab()
  }, [])
  // `startNewChat` is defined below (it needs `nav`), so bridge the ⌘⌥N keybinding
  // through a ref that the shortcut hook can call with a stable identity.
  const startNewChatRef = useRef<() => void>(() => {})
  const newChat = useCallback(() => startNewChatRef.current(), [])
  const shortcuts = useEditorShortcuts({
    isMobile,
    toggleSidebar,
    togglePanel: toggleMaximizeFocused,
    toggleBottomPanel: openTerminalTab,
    cycleTab: cycleFocusedTab,
    focusGroup: focusAdjacentGroup,
    focusPart,
    closeEditor: closeFocusedTab,
    reopenClosedTab,
    newChat,
  })

  return {
    ...shortcuts,
    toggleSidebar,
    toggleMaximizeFocused,
    openTerminalTab,
    cycleFocusedTab,
    focusAdjacentGroup,
    closeFocusedTab,
    reopenClosedTab,
    startNewChatRef,
  }
}
