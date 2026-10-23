import { useSyncExternalStore } from 'react'
import { saveString } from '@localixai/mini-app-sdk/ui/storage'

/**
 * Whether the setup dialog (the workspace tips, `widgets/workspace-tips`) is open. Shared, so the
 * update dialog can wait while it is: two dialogs at once would hide one behind the other.
 */
export const SETUP_DONE_KEY = 'localix.setup.done'

let open = false
const listeners = new Set<() => void>()

function set(next: boolean) {
  if (next === open) return
  open = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Show the setup dialog: at launch on a first run, or from the command palette. */
export const openSetup = (): void => set(true)

/** Close it, and remember that setup was seen so later launches do not open it again. */
export function closeSetup(): void {
  saveString(SETUP_DONE_KEY, '1')
  set(false)
}

export const useSetupOpen = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
