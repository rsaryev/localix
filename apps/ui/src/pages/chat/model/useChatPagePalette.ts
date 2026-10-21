import { useEffect, useMemo } from 'react'

import { inspector } from '@/shared/lib/inspectorBus'
import { focusTreeSearch } from '@/shared/lib/explorerBus'
import { useNotificationsStore } from '@/shared/lib/notifications/store'
import { CMD } from '@/shared/lib/keybindings'
import { navigateBack, navigateForward } from '@/shared/lib/navHistory'
import { focusPart } from '@/shared/lib/focusRing'
import { jumpToPrompt } from '@/shared/lib/transcriptNavBus'
import { cycleThemeMode } from '@/shared/theme/useTheme'
import { openSetup } from '@/shared/lib/setupDialog'
import { buildThirdPartyViewCommands } from '@/shared/contrib/thirdPartyViewCommands'
import { railSectionRegistry, railViewletRegistry } from '@/shared/contrib/uiContrib'
import { setUiCommands, type PaletteCommand } from '@/shared/contrib/uiCommands'
import { useUiLocationCommands } from '@/shared/contrib/useUiLocationCommands'
import { openPageWorkItem } from './openPageWorkItem'

interface ChatPagePaletteOptions {
  /** The chat the page has open — what a palette command that needs a chat acts on. */
  openSessionId: string | null
  enabledPluginNames: Set<string> | null
  thirdPartyViewsVersion: number
  switchSection: (id: string | null) => void
  setSidebarOpen: (open: boolean) => void
  setGlobalSearch: (open: boolean) => void
  setQuickOpen: (open: boolean) => void
  setGoToSymbol: (open: boolean) => void
  setWorkspaceSymbols: (open: boolean) => void
  setSessionSwitcher: (open: boolean) => void
  setProjectSwitcher: (open: boolean) => void
  startNewChat: () => void
  openProblems: () => void
  openTerminalTab: () => void
  toggleSidebar: () => void
  toggleMaximizeFocused: () => void
  focusAdjacentGroup: (direction: 1 | -1) => void
  cycleFocusedTab: (direction: 1 | -1) => void
  reopenClosedTab: () => void
}

/** Build and publish every workspace command exposed by the chat shell's palettes. */
export function useChatPagePalette({
  openSessionId,
  enabledPluginNames,
  thirdPartyViewsVersion,
  switchSection,
  setSidebarOpen,
  setGlobalSearch,
  setQuickOpen,
  setGoToSymbol,
  setWorkspaceSymbols,
  setSessionSwitcher,
  setProjectSwitcher,
  startNewChat,
  openProblems,
  openTerminalTab,
  toggleSidebar,
  toggleMaximizeFocused,
  focusAdjacentGroup,
  cycleFocusedTab,
  reopenClosedTab,
}: ChatPagePaletteOptions): PaletteCommand[] {
  const uiLocationCommands = useUiLocationCommands(openSessionId)
  const contributedViewCommands = useMemo<PaletteCommand[]>(() => {
    // Snapshot identity invalidates the owner-aware registry after a hot toggle.
    void enabledPluginNames
    return railSectionRegistry.list().flatMap((section) =>
      section.paletteLabel
        ? [
            {
              id: `view.${section.id}`,
              label: section.paletteLabel,
              group: 'View',
              effect: 'read',
              keywords: section.keywords ?? [],
              run: () => {
                switchSection(section.id)
                setSidebarOpen(true)
              },
            },
          ]
        : [],
    )
  }, [enabledPluginNames, setSidebarOpen, switchSection])

  // Palette opens are page commands: a view opens in the chat the page has open.
  const contributedViewletCommands = useMemo<PaletteCommand[]>(() => {
    void enabledPluginNames
    return railViewletRegistry.list().map((viewlet) => ({
      id: `view.${viewlet.kind}`,
      label: `Open ${viewlet.title}`,
      group: 'View',
      effect: 'read',
      keywords: viewlet.keywords ?? [],
      run: () =>
        openPageWorkItem(openSessionId, {
          workKind: viewlet.kind,
          id: viewlet.kind,
          title: viewlet.title,
        }),
    }))
  }, [enabledPluginNames, openSessionId])

  const thirdPartyViewCommands = useMemo<PaletteCommand[]>(() => {
    // The builder reads the runtime store directly; this version is its invalidation token.
    void thirdPartyViewsVersion
    return buildThirdPartyViewCommands({
      openWorkItem: ({ pluginName, projectId, viewId, fullName, title }) =>
        openPageWorkItem(openSessionId, {
          workKind: 'plugin-view',
          id: `plugin-view:${fullName}`,
          title,
          payload: { pluginName, projectId, viewId },
        }),
    })
  }, [thirdPartyViewsVersion, openSessionId])

  const commands = useMemo<PaletteCommand[]>(
    () => [
      {
        id: CMD.globalSearch,
        label: 'Global search…',
        group: 'Navigation',
        effect: 'read',
        chordId: CMD.globalSearch,
        keywords: ['find', 'everything', 'spotlight', 'search all', 'across'],
        run: () => setGlobalSearch(true),
      },
      {
        id: CMD.goToFile,
        label: 'Go to file…',
        group: 'Navigation',
        effect: 'read',
        chordId: CMD.goToFile,
        keywords: ['open', 'quick open'],
        run: () => setQuickOpen(true),
      },
      {
        id: CMD.goToSymbol,
        label: 'Go to symbol in file…',
        group: 'Navigation',
        effect: 'read',
        chordId: CMD.goToSymbol,
        keywords: ['outline'],
        run: () => setGoToSymbol(true),
      },
      {
        id: CMD.goToSymbolWorkspace,
        label: 'Go to symbol in workspace…',
        group: 'Navigation',
        effect: 'read',
        chordId: CMD.goToSymbolWorkspace,
        run: () => setWorkspaceSymbols(true),
      },
      {
        id: CMD.navigateBack,
        label: 'Go back',
        group: 'Navigation',
        effect: 'read',
        chordId: CMD.navigateBack,
        keywords: ['navigation', 'history', 'previous location'],
        run: navigateBack,
      },
      {
        id: CMD.navigateForward,
        label: 'Go forward',
        group: 'Navigation',
        effect: 'read',
        chordId: CMD.navigateForward,
        keywords: ['navigation', 'history', 'next location'],
        run: navigateForward,
      },
      {
        id: CMD.prevPrompt,
        label: 'Go to previous prompt',
        group: 'Navigation',
        effect: 'read',
        chordId: CMD.prevPrompt,
        keywords: ['transcript', 'turn', 'message', 'user prompt'],
        run: () => jumpToPrompt('prev'),
      },
      {
        id: CMD.nextPrompt,
        label: 'Go to next prompt',
        group: 'Navigation',
        effect: 'read',
        chordId: CMD.nextPrompt,
        keywords: ['transcript', 'turn', 'message', 'user prompt'],
        run: () => jumpToPrompt('next'),
      },
      {
        id: CMD.switchSession,
        label: 'Switch session…',
        group: 'Navigation',
        effect: 'read',
        chordId: CMD.switchSession,
        keywords: ['chat'],
        run: () => setSessionSwitcher(true),
      },
      {
        id: CMD.switchProject,
        label: 'Switch project…',
        group: 'Navigation',
        effect: 'read',
        chordId: CMD.switchProject,
        keywords: ['folder', 'workspace', 'open recent', 'directory'],
        run: () => setProjectSwitcher(true),
      },
      {
        id: CMD.newChat,
        label: 'New chat',
        group: 'Navigation',
        effect: 'write',
        chordId: CMD.newChat,
        keywords: ['create', 'session', 'start'],
        run: startNewChat,
      },
      {
        id: 'view.settings',
        label: 'Open Settings',
        group: 'View',
        effect: 'read',
        keywords: ['preferences', 'config'],
        run: () => inspector.openSettings(),
      },
      {
        id: 'view.setup',
        label: 'Set up Localix',
        group: 'View',
        effect: 'read',
        keywords: ['setup', 'onboarding', 'welcome', 'tips', 'getting started', 'tour'],
        run: openSetup,
      },
      {
        id: 'view.stats',
        label: 'Open Usage & Spend',
        group: 'View',
        effect: 'read',
        keywords: ['stats', 'cost', 'tokens'],
        run: () => inspector.openStats(),
      },
      {
        id: 'view.problems',
        label: 'Open Problems',
        group: 'View',
        effect: 'read',
        keywords: ['diagnostics', 'errors', 'warnings'],
        run: openProblems,
      },
      {
        id: 'view.terminal',
        label: 'Open terminal',
        group: 'View',
        effect: 'read',
        chordId: CMD.toggleTerminal,
        keywords: ['shell', 'console'],
        run: openTerminalTab,
      },
      {
        id: 'view.search',
        label: 'Search in Files',
        group: 'View',
        effect: 'read',
        keywords: ['find', 'grep', 'content'],
        run: () => {
          switchSection('files')
          focusTreeSearch('content')
        },
      },
      {
        id: 'view.files',
        label: 'Show Files',
        group: 'View',
        effect: 'read',
        keywords: ['explorer', 'tree'],
        run: () => switchSection('files'),
      },
      ...contributedViewCommands,
      ...contributedViewletCommands,
      ...thirdPartyViewCommands,
      {
        id: CMD.toggleSidebar,
        label: 'Toggle sidebar',
        group: 'Layout',
        effect: 'read',
        chordId: CMD.toggleSidebar,
        run: toggleSidebar,
      },
      {
        id: CMD.toggleEditorMaximize,
        label: 'Maximize editor group',
        group: 'Layout',
        effect: 'read',
        chordId: CMD.toggleEditorMaximize,
        run: toggleMaximizeFocused,
      },
      {
        id: CMD.focusNextGroup,
        label: 'Focus next editor group',
        group: 'Layout',
        effect: 'read',
        chordId: CMD.focusNextGroup,
        run: () => focusAdjacentGroup(1),
      },
      {
        id: CMD.focusPrevGroup,
        label: 'Focus previous editor group',
        group: 'Layout',
        effect: 'read',
        chordId: CMD.focusPrevGroup,
        run: () => focusAdjacentGroup(-1),
      },
      {
        id: CMD.focusNextPart,
        label: 'Focus next part',
        group: 'Layout',
        effect: 'read',
        chordId: CMD.focusNextPart,
        keywords: ['focus', 'part', 'f6'],
        run: () => focusPart(1),
      },
      {
        id: CMD.focusPrevPart,
        label: 'Focus previous part',
        group: 'Layout',
        effect: 'read',
        chordId: CMD.focusPrevPart,
        keywords: ['focus', 'part'],
        run: () => focusPart(-1),
      },
      {
        id: CMD.nextEditor,
        label: 'Next editor tab',
        group: 'Editor',
        effect: 'read',
        chordId: CMD.nextEditor,
        run: () => cycleFocusedTab(1),
      },
      {
        id: CMD.prevEditor,
        label: 'Previous editor tab',
        group: 'Editor',
        effect: 'read',
        chordId: CMD.prevEditor,
        run: () => cycleFocusedTab(-1),
      },
      {
        id: CMD.reopenClosedTab,
        label: 'Reopen closed tab',
        group: 'Editor',
        effect: 'write',
        chordId: CMD.reopenClosedTab,
        run: reopenClosedTab,
      },
      {
        id: CMD.pickTheme,
        label: 'Switch appearance',
        group: 'Preferences',
        // Cycles rather than opening a chooser: with three values, a picker is more steps than the
        // thing it picks. Same command the rail button and the chord run.
        effect: 'write',
        chordId: CMD.pickTheme,
        keywords: ['dark', 'light', 'system', 'mode', 'theme', 'appearance'],
        run: () => cycleThemeMode(),
      },
      // Opening the centre is not listed here: its surface descriptor
      // (`NotificationCenter.surface.ts`) already contributes that command through
      // `uiLocationCommands`, and a second hand-written copy put two rows in the palette.
      {
        id: 'notifications.markRead',
        label: 'Mark all events read',
        group: 'Events',
        effect: 'write',
        keywords: ['bell', 'alerts', 'clear unread', 'seen'],
        run: () => useNotificationsStore.getState().markAllRead(),
      },
      {
        id: 'notifications.clear',
        label: 'Clear event history',
        group: 'Events',
        effect: 'write',
        keywords: ['bell', 'alerts', 'dismiss', 'empty', 'remove'],
        run: () => useNotificationsStore.getState().clearHistory(),
      },
      ...uiLocationCommands,
    ],
    [
      contributedViewCommands,
      contributedViewletCommands,
      cycleFocusedTab,
      focusAdjacentGroup,
      openProblems,
      openTerminalTab,
      reopenClosedTab,
      setGlobalSearch,
      setGoToSymbol,
      setProjectSwitcher,
      setQuickOpen,
      setSessionSwitcher,
      setWorkspaceSymbols,
      startNewChat,
      switchSection,
      thirdPartyViewCommands,
      toggleMaximizeFocused,
      toggleSidebar,
      uiLocationCommands,
    ],
  )

  // Plugin command search and URI-anchor activation consume the same registry.
  useEffect(() => setUiCommands(commands), [commands])
  return commands
}
