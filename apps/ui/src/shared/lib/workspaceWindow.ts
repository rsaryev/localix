// Synchronous context injected before any store imports. Workspace layout and navigation
// are private to each native window; settings, server data and composer history stay shared.
import { tauriInvoke } from './tauri'
import { saveString } from '@localixai/mini-app-sdk/ui/storage'

export function workspaceStorageKey(key: string): string {
  const id = typeof window === 'undefined' ? undefined : window.__LOCALIX_WORKSPACE?.id
  return id && id !== 'main' ? `${key}:window:${id}` : key
}

/** The slice of a data router the location ledger reads; kept structural for tests. */
export interface WorkspaceRouteSource {
  state: { location: { pathname: string } }
  subscribe(listener: (state: { location: { pathname: string } }) => void): () => void
}

let reportedRoute: string | null = null

/**
 * Tell the desktop shell which route this window shows; it saves the route for the next launch.
 * Called only by the chat location ledger (`entities/chat/model/locationLedger.ts`), which
 * follows every router navigation. No-op outside a desktop workspace window.
 */
export function reportWorkspaceRoute(pathname: string): void {
  if (typeof window === 'undefined' || !window.__LOCALIX_WORKSPACE) return
  const route = pathname.split('?')[0] || '/'
  if (route === reportedRoute) return
  reportedRoute = route
  void tauriInvoke()?.('workspace_location', { route }).catch(() => {})
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
