import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

import { useChatStore, type ChatStore } from '@/entities/chat/model/store'
import { useGridStore } from '@/entities/workspace-grid/model'
import type { RoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { subscribeChatChrome } from '@/shared/lib/chatChromeBus'
import { toast } from '@/shared/lib/notify'
import { useChatPagePalette } from './useChatPagePalette'
import {
  scopedNewConversation,
  type ConversationStartStrategy,
} from '@/entities/chat/model/conversationStartStrategy'

interface NewChatActionOptions {
  /** The chat the page has open — handed to the palette commands that act on it. */
  openSessionId: string | null
  isMobile: boolean
  setSidebarOpen: (open: boolean) => void
  routeProjectId: string | null
  createSession: ChatStore['createSession']
  nav: RoutedNavigation
  startNewChatRef: RefObject<() => void>
  enabledPluginNames: Set<string> | null
  thirdPartyViewsVersion: number
  switchSection: (id: string | null) => void
  openProblems: () => void
  setGlobalSearch: (open: boolean) => void
  setQuickOpen: (open: boolean) => void
  setGoToSymbol: (open: boolean) => void
  setWorkspaceSymbols: (open: boolean) => void
  setSessionSwitcher: (open: boolean) => void
  setProjectSwitcher: (open: boolean) => void
  openTerminalTab: () => void
  toggleSidebar: () => void
  toggleMaximizeFocused: () => void
  focusAdjacentGroup: (direction: 1 | -1) => void
  cycleFocusedTab: (direction: 1 | -1) => void
  reopenClosedTab: () => void
  /** A plugin app starts its own next conversation instead (`useMiniApp`). */
  replaceNewChat?: (() => void) | null
}

export function useNewChatAction(options: NewChatActionOptions) {
  const {
    isMobile,
    setSidebarOpen,
    routeProjectId,
    createSession,
    nav,
    startNewChatRef,
    setProjectSwitcher,
    setSessionSwitcher,
    replaceNewChat,
  } = options
  // Start a new chat in the CURRENT scope — the rail "+" button, the ⌘⌥N and the
  // palette "New chat" command all run this. The scope is the active project (URL
  // is source of truth), or the default project while the neutral route is resolving.
  // The store reuses an untouched draft in that scope, so a second click lands on the
  // just-made empty draft instead of piling duplicates. Guarded against double-fire
  // via `creatingChat`.
  const [creatingChat, setCreatingChat] = useState(false)
  // State commits after the event handler returns. Keep an imperative latch too,
  // so two clicks in the same turn cannot both start a draft request.
  const creatingChatRef = useRef(false)
  // One imperative engine, parameterized by strategy, for every piece of chat chrome.
  const runNewChat = useCallback(
    (strategy: ConversationStartStrategy) => {
      if (creatingChatRef.current) return
      creatingChatRef.current = true
      if (isMobile) setSidebarOpen(false)
      setCreatingChat(true)
      void createSession(undefined, strategy)
        .then((session) => {
          if (session) {
            // The store reuses an untouched draft, so "new chat" can land on the session that
            // is already selected — with its tab closed (launch keeps the layout it restored).
            // The route does not change then, so open the tab here, as re-clicking a chat does.
            if (session.id === useChatStore.getState().activeSessionId)
              useGridStore.getState().reopenChat(session.id)
            nav.goToSession(session.id, { project: session.projectId })
          } else
            toast.error('Could not start a new conversation', {
              description: 'No conversation came back from the server. Try again.',
            })
        })
        .catch((e: unknown) =>
          toast.error('Could not start a new conversation', {
            description: errorMessage(e, '') || undefined,
          }),
        )
        .finally(() => {
          creatingChatRef.current = false
          setCreatingChat(false)
        })
    },
    [isMobile, setSidebarOpen, createSession, nav],
  )
  // DOM handlers always receive an event argument. Keep the public chrome callback truly
  // zero-argument so a MouseEvent can never be mistaken for a ConversationStartStrategy.
  const startNewChat = useCallback(
    () => (replaceNewChat ? replaceNewChat() : runNewChat(scopedNewConversation(routeProjectId))),
    [replaceNewChat, routeProjectId, runNewChat],
  )
  // `startNewChatRef` is created once by useEditorGridCommands.
  useEffect(() => {
    startNewChatRef.current = startNewChat
  }, [startNewChat, startNewChatRef])

  // The unified breadcrumb now lives in the chat header (deep in the editor grid);
  // it reaches these page-level affordances (Search-all modals + New chat) through
  // the shared chrome bus instead of prop threading through the grid registry.
  useEffect(
    () =>
      subscribeChatChrome((event) => {
        if (event === 'project-switcher') setProjectSwitcher(true)
        else setSessionSwitcher(true)
      }),
    [setProjectSwitcher, setSessionSwitcher],
  )

  const paletteCommands = useChatPagePalette({ ...options, startNewChat })
  return { creatingChat, paletteCommands, startNewChat, startNewChatWith: runNewChat }
}
