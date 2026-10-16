import { tauriInvoke } from './tauri'
import { isDesktopRuntime, OS_FAMILY, type OsFamily } from '@localixai/kit/environment'

declare global {
  interface Window {
    __LOCALIX_COMPANION?: boolean
  }
}

/** The companion has its own shell and never becomes a workspace or a native tab. */
export function supportsAgentIsland(desktop: boolean, os: OsFamily): boolean {
  return !desktop || os === 'mac'
}

export function isCompanionWindow(): boolean {
  if (!supportsAgentIsland(isDesktopRuntime(), OS_FAMILY)) return false
  return window.__LOCALIX_COMPANION === true || window.location.hash === '#/companion'
}

export async function openCompanionSession(sessionId: string): Promise<void> {
  const invoke = tauriInvoke()
  if (invoke) await invoke('companion_open_session', { sessionId })
  else window.location.assign(`/#/chat/${encodeURIComponent(sessionId)}`)
}
