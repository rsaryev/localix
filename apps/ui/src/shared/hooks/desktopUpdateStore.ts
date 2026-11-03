import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'

import type { DesktopUpdateState } from './useDesktopUpdate'

/**
 * The desktop update state every reader shares, and the version whose notice the person hid.
 * Module state, read through `useSyncExternalStore` by `useDesktopUpdate`.
 */

// ONE state for every reader. Each hook instance used to keep its own copy, so a check run from
// Settings would have left the rail button silent until its next hourly poll.
let shared: DesktopUpdateState | null = null
export const sharedUpdate = (): DesktopUpdateState | null => shared
const listeners = new Set<() => void>()
export function publish(next: DesktopUpdateState | null) {
  shared = next
  for (const listener of listeners) listener()
}
export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// The version whose notice the person hid. Remembered across launches, so a dismissed update does
// not come back on every start; a NEWER version is a different notice and shows again. The rail
// button and Settings still show an available update: this only quiets the composer strip.
const DISMISSED_KEY = 'localix.update.dismissed'
let dismissedVersion: string | null = null
let dismissedRead = false
export function dismissed(): string | null {
  if (!dismissedRead && typeof window !== 'undefined') {
    dismissedVersion = loadString(DISMISSED_KEY)
    dismissedRead = true
  }
  return dismissedVersion
}

/** Hide the composer notice for `version`, and keep it hidden until a newer one is available. */
export function dismissUpdateNotice(version: string | null): void {
  dismissedVersion = version
  dismissedRead = true
  // A blocked store keeps it hidden for this launch, which is all that was asked.
  saveString(DISMISSED_KEY, version)
  for (const listener of listeners) listener()
}
