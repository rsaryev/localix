import { useEffect, useSyncExternalStore } from 'react'

/**
 * The port through which a surface that is not the standalone-app feature offers a mini app's
 * desktop app (its own Mac app: a window, a Dock icon, a place in Spotlight). The store asks for
 * it; `features/standalone-mini-apps` provides it, wired at start-up (`app/workspaceEntry.tsx`),
 * so neither feature imports the other.
 */
export interface MiniAppDesktopApps {
  /** Whether this mini app can become a desktop app here: the macOS shell, a screen of its own. */
  available: (miniApp: string, surfaces?: readonly string[]) => boolean
  /** The mini apps that have one now. */
  installed: () => readonly string[]
  subscribe: (listener: () => void) => () => void
  /** Read the list again from the shell (a bundle can be deleted in Finder at any time). */
  refresh: () => void
  /** Make the desktop app, with the mini app's own icon; rejects with what went wrong. */
  install: (miniApp: string, title: string) => Promise<void>
  remove: (miniApp: string) => Promise<void>
}

let provided: MiniAppDesktopApps | null = null

export function provideMiniAppDesktopApps(port: MiniAppDesktopApps): void {
  provided = port
}

export function miniAppDesktopApps(): MiniAppDesktopApps | null {
  return provided
}

const NONE: readonly string[] = []
const noSubscription = () => () => {}

/** The provided port and the mini apps with a desktop app, kept current while shown; null when none. */
export function useMiniAppDesktopApps(): {
  port: MiniAppDesktopApps
  installed: readonly string[]
} | null {
  const port = provided
  useEffect(() => port?.refresh(), [port])
  const installed = useSyncExternalStore(
    port?.subscribe ?? noSubscription,
    port?.installed ?? (() => NONE),
  )
  return port ? { port, installed } : null
}
