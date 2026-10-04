import { useEffect } from 'react'
import { backendClient } from '@/shared/api/client'
import { inspector } from '@/shared/lib/inspectorBus'
import { requireOpenChat } from '@/shared/lib/pageOpenChat'
import { subscribeMenuCommands } from '@/shared/lib/menuBus'
import { beginNewFile } from '@/shared/lib/explorerBus'
import { saveActiveEditor } from '@/shared/lib/activeEditorBus'
import { navigateSettings } from '@/shared/lib/settingsNavBus'
import { openNewTerminal } from '@/features/terminal/model/terminalTabs'

interface MenuCommandsOptions {
  /** The chat the page has open — what a file or terminal menu command acts on; null when none. */
  openSessionId: string | null
  addProjectFolder: () => void | Promise<unknown>
  switchSection: (id: string | null) => void
  setSidebarOpen: (open: boolean) => void
  setCommandPalette: (open: boolean) => void
  closeEditor: () => void
  toggleSidebar: () => void
  openTerminalTab: () => void
}

/**
 * Native application-menu commands (Tauri desktop shell) → in-app actions. The
 * shell forwards each menu id via window.__localixMenu → menuBus; we dispatch it
 * here to the same actions the rail buttons / command palette run. Deep-link and
 * Settings items are handled shell-side and never reach this bridge.
 *
 * Sibling of {@link useTerminalBusWiring}: a self-contained bus subscription kept
 * out of ChatPage's body so the page reads as layout + routing, not wiring.
 */
export function useMenuCommands(opts: MenuCommandsOptions): void {
  const {
    openSessionId,
    addProjectFolder,
    switchSection,
    setSidebarOpen,
    setCommandPalette,
    closeEditor,
    toggleSidebar,
    openTerminalTab,
  } = opts
  useEffect(
    () =>
      subscribeMenuCommands((command) => {
        switch (command) {
          case 'open_project':
            void addProjectFolder()
            break
          case 'open_file': {
            // A menu command acts on the chat the page has open; with none open it says so
            // before the picker appears, rather than after the person chose files.
            const sessionId = requireOpenChat(openSessionId)
            if (!sessionId) break
            void backendClient.pickFiles().then((paths) => {
              paths.forEach((path) => inspector.openFile({ sessionId, path }))
            })
            break
          }
          case 'new_file':
            switchSection('files')
            setSidebarOpen(true)
            // Let the Files section mount before the tree begins the inline entry.
            requestAnimationFrame(() => beginNewFile())
            break
          case 'save_file':
            saveActiveEditor()
            break
          case 'close_tab':
            closeEditor()
            break
          case 'command_palette':
            setCommandPalette(true)
            break
          case 'toggle_sidebar':
            toggleSidebar()
            break
          case 'toggle_terminal':
            openTerminalTab()
            break
          case 'new_terminal': {
            const sessionId = requireOpenChat(openSessionId)
            if (sessionId) void openNewTerminal(sessionId)
            break
          }
          case 'view_stats':
            inspector.openStats()
            break
          case 'help_shortcuts':
            inspector.openSettings()
            navigateSettings('shortcuts')
            break
          case 'help_diagnostics':
            inspector.openSettings()
            navigateSettings('diagnostics')
            break
        }
      }),
    [
      openSessionId,
      addProjectFolder,
      switchSection,
      setSidebarOpen,
      setCommandPalette,
      closeEditor,
      toggleSidebar,
      openTerminalTab,
    ],
  )
}
