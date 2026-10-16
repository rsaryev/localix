import { loadString, saveString } from '@localixai/plugin-sdk/ui/storage'

type StorageReader = Parameters<typeof loadString>[1]
type StorageWriter = Parameters<typeof saveString>[2]

const SIDEBAR_OPEN_KEY = 'localix_sidebar_open'

/**
 * The left sidebar's open state on launch. A first run (nothing stored) starts collapsed so a
 * new person lands on a calm workspace; a returning person gets the state they left. On mobile
 * the sidebar is a full overlay, so it never reopens on load.
 */
export function initialSidebarOpen(mobile: boolean, storage?: StorageReader): boolean {
  if (mobile) return false
  return loadString(SIDEBAR_OPEN_KEY, storage) === '1'
}

/** Record an explicit desktop open/close so the next launch restores it. */
export function rememberSidebarOpen(open: boolean, storage?: StorageWriter): void {
  saveString(SIDEBAR_OPEN_KEY, open ? '1' : '0', storage)
}
