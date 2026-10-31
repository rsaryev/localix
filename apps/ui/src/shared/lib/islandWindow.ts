import { platformCapabilities } from './platformCapabilities'
import { isDesktopRuntime, OS_FAMILY, type OsFamily } from '@localixai/kit/environment'

declare global {
  interface Window {
    __LOCALIX_ISLAND?: boolean
  }
}

/** The island has its own shell and never becomes a workspace or a native tab. */
export function supportsAgentIsland(desktop: boolean, os: OsFamily): boolean {
  return !desktop || os === 'mac'
}

export function isIslandWindow(): boolean {
  if (!supportsAgentIsland(isDesktopRuntime(), OS_FAMILY)) return false
  return window.__LOCALIX_ISLAND === true || window.location.hash === '#/island'
}

/** "Open chat" on the card: the app shows that conversation, and the request stays pending. */
export async function openIslandSession(sessionId: string): Promise<void> {
  const opened = platformCapabilities().desktop.invoke('island_open_session', { sessionId })
  if (opened) await opened
  else window.location.assign(`/#/chat/${encodeURIComponent(sessionId)}`)
}
