import { createEventChannel } from './eventChannel'

/**
 * Bridge for native application-menu items that map to in-app actions with no
 * deep-link route (Open File, Save, Toggle Sidebar, the View panel openers, …).
 *
 * The Tauri shell can't reach the React tree directly, so its `on_menu_event`
 * handler `eval`s `window.__localixMenu(id)` (installed by {@link useNativeMenu}),
 * which forwards the menu id here. The page that owns the workspace actions
 * (`ChatPage`) subscribes and dispatches each id to the matching action.
 *
 * Mirrors {@link chatChromeBus}/{@link explorerBus}: coordination through `shared`
 * keeps the dependency arrow one-directional (shell hook → shared ← page) instead
 * of threading callbacks through the router. The command ids are a small string
 * contract shared with the Rust menu builder (see `desktop-tauri/src/lib.rs`).
 */

/** Native-menu command ids the shell forwards. Keep in sync with `lib.rs`. */
export type MenuCommand =
  | 'open_project'
  | 'open_file'
  | 'new_file'
  | 'save_file'
  | 'close_tab'
  | 'command_palette'
  | 'toggle_sidebar'
  | 'toggle_terminal'
  | 'new_terminal'
  | 'view_stats'
  | 'help_shortcuts'
  | 'help_diagnostics'

type MenuListener = (command: MenuCommand) => void

const channel = createEventChannel<[command: MenuCommand]>()

/** Dispatch a native-menu command to every subscriber (from `window.__localixMenu`). */
export function runMenuCommand(command: string): void {
  channel.publish(command as MenuCommand)
}

/** Subscribe to native-menu commands; returns an unsubscribe for teardown/HMR. */
export function subscribeMenuCommands(listener: MenuListener): () => void {
  return channel.subscribe(listener)
}
