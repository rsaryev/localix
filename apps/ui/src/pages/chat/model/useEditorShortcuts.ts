import { useState, useEffect, useCallback, useRef } from 'react'
import { CMD } from '@/shared/lib/keybindings'
import { registerActionHandler } from '@/shared/lib/actions'
import { cycleThemeMode } from '@/shared/theme/useTheme'
import { navigateBack, navigateForward } from '@/shared/lib/navHistory'
import { jumpToPrompt } from '@/shared/lib/transcriptNavBus'
import { currentKeyPolicy } from '@localixai/plugin-sdk/ui/focus'

export interface EditorShortcutsState {
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
  splitEditor: () => void
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
    splitEditor,
    closeEditor,
    reopenClosedTab,
    newChat,
  } = opts
  const [commandPalette, setCommandPaletteState] = useState(false)
  const [quickOpen, setQuickOpenState] = useState(false)
  const [sessionSwitcher, setSessionSwitcherState] = useState(false)
  const [projectSwitcher, setProjectSwitcherState] = useState(false)
  const [goToSymbol, setGoToSymbolState] = useState(false)
  const [workspaceSymbols, setWorkspaceSymbolsState] = useState(false)
  const [globalSearch, setGlobalSearchState] = useState(false)
  const commandPaletteMounted = useRef(false)
  const quickOpenMounted = useRef(false)
  const sessionSwitcherMounted = useRef(false)
  const projectSwitcherMounted = useRef(false)
  const goToSymbolMounted = useRef(false)
  const workspaceSymbolsMounted = useRef(false)
  const globalSearchMounted = useRef(false)
  const setCommandPalette = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((next) => {
    setCommandPaletteState((current) => {
      const value = typeof next === 'function' ? next(current) : next
      if (value) commandPaletteMounted.current = true
      return value
    })
  }, [])
  const setQuickOpen = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((next) => {
    setQuickOpenState((current) => {
      const value = typeof next === 'function' ? next(current) : next
      if (value) quickOpenMounted.current = true
      return value
    })
  }, [])
  const setSessionSwitcher = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((next) => {
    setSessionSwitcherState((current) => {
      const value = typeof next === 'function' ? next(current) : next
      if (value) sessionSwitcherMounted.current = true
      return value
    })
  }, [])
  const setProjectSwitcher = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((next) => {
    setProjectSwitcherState((current) => {
      const value = typeof next === 'function' ? next(current) : next
      if (value) projectSwitcherMounted.current = true
      return value
    })
  }, [])
  const setGoToSymbol = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((next) => {
    setGoToSymbolState((current) => {
      const value = typeof next === 'function' ? next(current) : next
      if (value) goToSymbolMounted.current = true
      return value
    })
  }, [])
  const setWorkspaceSymbols = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((next) => {
    setWorkspaceSymbolsState((current) => {
      const value = typeof next === 'function' ? next(current) : next
      if (value) workspaceSymbolsMounted.current = true
      return value
    })
  }, [])
  const setGlobalSearch = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((next) => {
    setGlobalSearchState((current) => {
      const value = typeof next === 'function' ? next(current) : next
      if (value) globalSearchMounted.current = true
      return value
    })
  }, [])

  // The tracked setters are stable wrappers around React state setters.
  useEffect(() => {
    const disposers = [
      registerActionHandler({ commandId: CMD.nextEditor, run: () => cycleTab(1) }),
      registerActionHandler({ commandId: CMD.prevEditor, run: () => cycleTab(-1) }),
      registerActionHandler({ commandId: CMD.focusNextGroup, run: () => focusGroup(1) }),
      registerActionHandler({ commandId: CMD.focusPrevGroup, run: () => focusGroup(-1) }),
      registerActionHandler({ commandId: CMD.focusNextPart, run: () => focusPart(1) }),
      registerActionHandler({ commandId: CMD.focusPrevPart, run: () => focusPart(-1) }),
      registerActionHandler({ commandId: CMD.splitEditor, run: splitEditor }),
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
    splitEditor,
    closeEditor,
    reopenClosedTab,
    newChat,
  ])

  // The tracked setter is stable for the lifetime of this hook.
  useEffect(() => {
    // F1 remains a fixed, non-configurable alternate for the command palette: the catalog carries
    // one chord per command, so a second binding cannot be expressed there. It still has to respect
    // who owns the keyboard — it used to fire from behind an open modal — so it asks the focus stack
    // the same question the dispatcher asks before resolving any plain key.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (!currentKeyPolicy().plainKeys) return
        e.preventDefault()
        setCommandPalette((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    commandPaletteMounted: commandPaletteMounted.current,
    quickOpenMounted: quickOpenMounted.current,
    sessionSwitcherMounted: sessionSwitcherMounted.current,
    projectSwitcherMounted: projectSwitcherMounted.current,
    goToSymbolMounted: goToSymbolMounted.current,
    workspaceSymbolsMounted: workspaceSymbolsMounted.current,
    globalSearchMounted: globalSearchMounted.current,
  }
}
