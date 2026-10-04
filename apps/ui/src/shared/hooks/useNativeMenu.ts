import { useEffect } from 'react'
import { isDesktop } from '@localixai/kit/environment'
import { inspector } from '@/shared/lib/inspectorBus'
import { runMenuCommand } from '@/shared/lib/menuBus'
import { runNativeEditCommand } from '@/shared/lib/nativeEditing'

declare global {
  interface Window {
    /** Installed by useNativeMenu; the Tauri shell calls it from Settings… (Cmd+,). */
    __localixOpenSettings?: () => void
    /** Installed by useNativeMenu; the shell forwards native-menu command ids here. */
    __localixMenu?: (command: string) => void
    /** Native edit commands use text focus without revealing or focusing another webview. */
    __localixEdit?: (command: string) => boolean
  }
}

/**
 * Bridge native application-menu items to in-app actions. The Tauri shell can't
 * reach the React tree directly, so menu handlers `eval` a `window.__localix*`
 * callback the UI installs here:
 *  - Settings… (Cmd+,) → open the inspector Settings panel (no URL route).
 *  - Every other action item forwards its id to the {@link menuBus}; the page that
 *    owns the workspace actions (ChatPage) subscribes and dispatches it.
 * No-op outside the desktop shell.
 */
export function useNativeMenu(): void {
  useEffect(() => {
    if (!isDesktop) return
    window.__localixOpenSettings = () => inspector.openSettings()
    window.__localixMenu = (command: string) => runMenuCommand(command)
    window.__localixEdit = runNativeEditCommand
    return () => {
      delete window.__localixOpenSettings
      delete window.__localixMenu
      delete window.__localixEdit
    }
  }, [])
}
