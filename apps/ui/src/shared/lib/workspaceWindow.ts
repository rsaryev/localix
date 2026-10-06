// Synchronous context injected before any store imports. Workspace layout and navigation
// are private to each native window; settings, server data and composer history stay shared.
import { tauriInvoke } from './tauri'
import { saveString } from '@localixai/plugin-sdk/ui/storage'

export function workspaceStorageKey(key: string): string {
  const id = typeof window === 'undefined' ? undefined : window.__LOCALIX_WORKSPACE?.id
  return id && id !== 'main' ? `${key}:window:${id}` : key
}

/** Hash routes survive runtime reloads and are saved by the shell for the next launch. */
export function installWorkspaceLocation(): () => void {
  if (typeof window === 'undefined' || !window.__LOCALIX_WORKSPACE) return () => {}
  const report = () => {
    const route = (window.location.hash.slice(1) || '/').split('?')[0]
    void tauriInvoke()?.('workspace_location', { route }).catch(() => {})
  }
  window.addEventListener('hashchange', report)
  report()
  return () => window.removeEventListener('hashchange', report)
}

/** Closed native workspaces will not be restored; release only their private layout keys. */
export function clearWorkspaceStorage(): void {
  const id = typeof window === 'undefined' ? undefined : window.__LOCALIX_WORKSPACE?.id
  if (!id || id === 'main') return
  try {
    const marker = `:window:${id}`
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index)
      if (key?.includes(marker)) saveString(key, null)
    }
  } catch {
    // Storage unavailable: the window can still close.
  }
}
