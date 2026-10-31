import { useState, useEffect } from 'react'
import { CMD } from '@/shared/lib/keybindings'
import { registerActionHandler } from '@/shared/lib/actions'
import { cycleThemeMode } from '@/shared/theme/useTheme'
import { navigateBack, navigateForward } from '@/shared/lib/navHistory'
import { jumpToPrompt } from '@/shared/lib/transcriptNavBus'

interface EditorShortcutsState {
  commandPalette: boolean
  setCommandPalette: React.Dispatch<React.SetStateAction<boolean>>
  quickOpen: boolean
  setQuickOpen: React.Dispatch<React.SetStateAction<boolean>>
  sessionSwitcher: boolean
  setSessionSwitcher: React.Dispatch<React.SetStateAction<boolean>>
  projectSwitcher: boolean
  setProjectSwitcher: React.Dispatch<React.SetStateAction<boolean>>
  goToSymbol: boolean
  setGoToSymbol: React.Dispatch<React.SetStateAction<boolean>>
  workspaceSymbols: boolean
  setWorkspaceSymbols: React.Dispatch<React.SetStateAction<boolean>>
  globalSearch: boolean
  setGlobalSearch: React.Dispatch<React.SetStateAction<boolean>>
  commandPaletteMounted: boolean
  quickOpenMounted: boolean
  sessionSwitcherMounted: boolean
  projectSwitcherMounted: boolean
  goToSymbolMounted: boolean
  workspaceSymbolsMounted: boolean
  globalSearchMounted: boolean
}

/**
 * A palette's open flag, its setter, and whether it has ever opened: a lazy palette mounts the
 * first time it opens and stays mounted after, so reopening it is as quick as an eager one.
 */
function useStickyOpen() {
  const [open, setOpen] = useState(false)
  const [opened, setOpened] = useState(false)
  // Derived during render, React's way of adjusting state to a change: no effect, no ref.
  if (open && !opened) setOpened(true)
  return [open, setOpen, opened || open] as const
}

/**
 * Global editor shortcuts. Every binding here is resolved
 * through the keybindings registry (`useKeybindings`), so a user rebind in
 * Settings → Keyboard shortcuts takes effect immediately. Defaults: ⌘/Ctrl+⇧+P
 * command palette (run any command by name; F1 is a fixed alternate); ⌘/Ctrl+P
 * go-to-file palette; ⌘/Ctrl+K session switcher; ⌘/Ctrl+⌥+P project
 * quick-switcher; ⌘/Ctrl+⇧+O go-to-symbol;
 * ⌘/Ctrl+T workspace symbols; ⌘/Ctrl+⌥+T color-theme quick pick; ⌥+←/→ step back/forward through the editor
 * navigation history; ⌘/Ctrl+B toggles the sidebar; ⌘/Ctrl+J maximizes
 * the focused group; ⌘/Ctrl+` opens a terminal tab; ⌘/Ctrl+⌥+←/→ cycle the
 * focused group's tabs; ⌘/Ctrl+\ splits the focused group to the right;
 * ⌘/Ctrl+W closes its active tab; ⌘/Ctrl+⇧+T reopens the last closed file tab. The two
 * generic `toggle*` props are wired to grid actions by ChatPage. `preventDefault`
 * covers the native combos when a binding fires.
 */
export function useEditorShortcuts(opts: {
  isMobile: boolean
  toggleSidebar: () => void
  togglePanel: () => void
  toggleBottomPanel: () => void
  cycleTab: (dir: 1 | -1) => void
  focusGroup: (dir: 1 | -1) => void
  focusPart: (dir: 1 | -1) => void
  closeEditor: () => void
  reopenClosedTab: () => void
  newChat: () => void
}): EditorShortcutsState {
  const {
    isMobile,
    toggleSidebar,
    togglePanel,
    toggleBottomPanel,
    cycleTab,
    focusGroup,
    focusPart,
    closeEditor,
    reopenClosedTab,
    newChat,
  } = opts
  const [commandPalette, setCommandPalette, commandPaletteMounted] = useStickyOpen()
  const [quickOpen, setQuickOpen, quickOpenMounted] = useStickyOpen()
  const [sessionSwitcher, setSessionSwitcher, sessionSwitcherMounted] = useStickyOpen()
  const [projectSwitcher, setProjectSwitcher, projectSwitcherMounted] = useStickyOpen()
  const [goToSymbol, setGoToSymbol, goToSymbolMounted] = useStickyOpen()
  const [workspaceSymbols, setWorkspaceSymbols, workspaceSymbolsMounted] = useStickyOpen()
  const [globalSearch, setGlobalSearch, globalSearchMounted] = useStickyOpen()

  // The palette setters are React state setters, stable across renders.
  useEffect(() => {
    const disposers = [
      registerActionHandler({ commandId: CMD.nextEditor, run: () => cycleTab(1) }),
      registerActionHandler({ commandId: CMD.prevEditor, run: () => cycleTab(-1) }),
      registerActionHandler({ commandId: CMD.focusNextGroup, run: () => focusGroup(1) }),
      registerActionHandler({ commandId: CMD.focusPrevGroup, run: () => focusGroup(-1) }),
      registerActionHandler({ commandId: CMD.focusNextPart, run: () => focusPart(1) }),
      registerActionHandler({ commandId: CMD.focusPrevPart, run: () => focusPart(-1) }),
      registerActionHandler({ commandId: CMD.closeEditor, run: closeEditor }),
      registerActionHandler({ commandId: CMD.reopenClosedTab, run: reopenClosedTab }),
      registerActionHandler({
        commandId: CMD.commandPalette,
        run: () => setCommandPalette((value) => !value),
      }),
      registerActionHandler({
        commandId: CMD.globalSearch,
        run: () => setGlobalSearch((value) => !value),
      }),
      registerActionHandler({ commandId: CMD.navigateBack, run: navigateBack }),
      registerActionHandler({ commandId: CMD.navigateForward, run: navigateForward }),
      registerActionHandler({ commandId: CMD.prevPrompt, run: () => jumpToPrompt('prev') }),
      registerActionHandler({ commandId: CMD.nextPrompt, run: () => jumpToPrompt('next') }),
      registerActionHandler({
        commandId: CMD.goToSymbol,
        run: () => setGoToSymbol((value) => !value),
      }),
      registerActionHandler({
        commandId: CMD.goToFile,
        run: () => setQuickOpen((value) => !value),
      }),
      registerActionHandler({
        commandId: CMD.goToSymbolWorkspace,
        run: () => setWorkspaceSymbols((value) => !value),
      }),
      registerActionHandler({
        commandId: CMD.switchSession,
        run: () => setSessionSwitcher((value) => !value),
      }),
      registerActionHandler({
        commandId: CMD.switchProject,
        run: () => setProjectSwitcher((value) => !value),
      }),
      registerActionHandler({ commandId: CMD.pickTheme, run: () => cycleThemeMode() }),
      registerActionHandler({ commandId: CMD.newChat, run: newChat }),
      registerActionHandler({
        commandId: CMD.toggleSidebar,
        run: toggleSidebar,
        enabled: () => !isMobile,
      }),
      registerActionHandler({ commandId: CMD.toggleEditorMaximize, run: togglePanel }),
      registerActionHandler({
        commandId: CMD.toggleTerminal,
        run: toggleBottomPanel,
        enabled: () => !isMobile,
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isMobile,
    toggleSidebar,
    togglePanel,
    toggleBottomPanel,
    cycleTab,
    focusGroup,
    focusPart,
    closeEditor,
    reopenClosedTab,
    newChat,
  ])

  return {
    commandPalette,
    setCommandPalette,
    quickOpen,
    setQuickOpen,
    sessionSwitcher,
    setSessionSwitcher,
    projectSwitcher,
    setProjectSwitcher,
    goToSymbol,
    setGoToSymbol,
    workspaceSymbols,
    setWorkspaceSymbols,
    globalSearch,
    setGlobalSearch,
    commandPaletteMounted,
    quickOpenMounted,
    sessionSwitcherMounted,
    projectSwitcherMounted,
    goToSymbolMounted,
    workspaceSymbolsMounted,
    globalSearchMounted,
  }
}
