import { useEffect } from 'react'

import { useChatEventStream } from '@/features/chat/model/agent-runtime'
import { useChatStore } from '@/features/chat/model/store'
import { findSessionInState } from '@/features/chat/model/findSession'
import { usePlanEventFocus } from '@/features/chat/model/planEventFocus'
import { usePluginViewAgent } from '@/features/inspector/ui/usePluginViewAgent'
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle'
import { subscribeRevealInTree } from '@/shared/lib/explorerBus'
import { publishPageOpenChat } from '@/shared/lib/pageOpenChat'
import { subscribeSidebarSection } from '@/shared/lib/sidebarSectionBus'
import { subscribeWorkspaceChrome } from '@/shared/lib/workspaceChromeBus'
import { useFollowShownChat, useGridChatSync, useGridInspectorBus } from '@/widgets/editor-grid'
import { useMenuCommands } from './useMenuCommands'
import { useTerminalBusWiring } from './useTerminalBusWiring'

export function useChatPageBuses({ hasHydrated }: { hasHydrated: boolean }): void {
  // DATA PLANE — the single realtime socket subscription that streams every
  // session into the store (so any number of ChatSurfaces just read their slice).
  useChatEventStream(hasHydrated)
  // Route every inspector open-request (file/diff/preview/work-item/agent reveals)
  // onto the editor grid as a WorkItem.
  useGridInspectorBus()
  // The agent's `browser` commands for `plugin:<name>`: the workbench is where a plugin's view
  // lives, so this page is the host that opens and drives it.
  usePluginViewAgent()
}

export function useWorkspaceBuses({
  activeSessionId,
  sessionTitle,
  switchSection,
  setSidebarOpen,
  goToSession,
}: {
  activeSessionId: string | null
  sessionTitle: string | null
  switchSection: (id: string | null) => void
  setSidebarOpen: (open: boolean) => void
  goToSession: (id: string) => void
}): void {
  // "Reveal in Tree" (editor tab menu) → surface the Explorer so the file tree,
  // which auto-reveals the active file, can scroll/select the just-revealed path.
  useEffect(() => subscribeRevealInTree(() => switchSection('files')), [switchSection])

  // Sibling slices (e.g. the .sql file panel) can open a named sidebar section
  // (Database) without importing the page/router — mirrors the reveal-in-tree bus.
  // `setSidebarOpen` is the stable React setter supplied by ChatPage; preserve the
  // original effect dependency list while moving this wiring intact.
  useEffect(
    () =>
      subscribeSidebarSection((id) => {
        switchSection(id)
        setSidebarOpen(true)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [switchSection],
  )
  // A distraction-free `localix <file>` open collapses the chrome to show just the
  // editor (paired with the grid maximizing the file's group).
  useEffect(() => {
    const unsubscribe = subscribeWorkspaceChrome(() => setSidebarOpen(false))
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable React state setter
  }, [])

  useDocumentTitle({ sessionTitle: sessionTitle ?? undefined })

  // The active session drives the editor grid's scope (its workspace) + seeds its
  // `chat:<id>` WorkItem. The grid switches sessions back only within one
  // workspace: showing a sibling's chat tab (a sub-session beside its parent)
  // navigates to it, as the sidebar would.
  useGridChatSync({ activeSessionId, sessionTitle })
  useFollowShownChat(activeSessionId, goToSession)
}

export function useMenuTerminalBuses({
  activeSessionId,
  switchSection,
  setSidebarOpen,
  addProjectFolder,
  setCommandPalette,
  closeFocusedTab,
  toggleSidebar,
  openTerminalTab,
}: {
  activeSessionId: string | null
  switchSection: (id: string | null) => void
  setSidebarOpen: (open: boolean) => void
  addProjectFolder: () => void | Promise<unknown>
  setCommandPalette: (open: boolean) => void
  closeFocusedTab: () => void
  toggleSidebar: () => void
  openTerminalTab: () => void
}): void {
  // Native application-menu commands (Tauri desktop shell) → the same in-app
  // actions the rail buttons / command palette run (extracted bus wiring).
  useMenuCommands({
    openSessionId: activeSessionId,
    addProjectFolder,
    switchSection,
    setSidebarOpen,
    setCommandPalette,
    closeEditor: closeFocusedTab,
    toggleSidebar,
    openTerminalTab,
  })

  // Transcript code blocks / background jobs reveal the Terminal as a grid tab.
  useTerminalBusWiring({ activeSessionId })
  // An Event Center "Review plan" opens the plan tab once its chat is the one on screen.
  usePlanEventFocus(activeSessionId)
  // The app-installed intents (an OS deep link, an OS file drop) act on the chat this page has
  // open; publishing it here is the one place they learn which that is.
  const openProjectId = useChatStore((state) => {
    const session = findSessionInState(state, activeSessionId)
    return session?.projectId === state.activeProjectId ? (session?.projectId ?? null) : null
  })
  useEffect(
    () => publishPageOpenChat(activeSessionId, openProjectId),
    [activeSessionId, openProjectId],
  )
}
