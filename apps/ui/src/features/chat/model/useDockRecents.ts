import { useEffect } from 'react'
import { isDesktop } from '@localixai/kit/environment'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import type { UiSession } from '@/shared/api/contracts'
import { useChatStore } from './store'
import { isThreadSession, isWorkerSession } from './useSidebarSessions'

/** How many recent chats to surface in File ▸ Open Recent (a menu, not a list). */
const MAX_RECENTS = 8

/** The most-recently-used top-level chats as `{ id, title }`, newest first. */
function selectRecents(allSessions: UiSession[]): Array<{ id: string; title: string }> {
  return (
    allSessions
      // Top-level chats only — no workers/threads/forks, no archived, and a real
      // (auto-)title so brand-new empty drafts don't show as "Untitled".
      .filter(
        (s) =>
          !isWorkerSession(s) &&
          !isThreadSession(s) &&
          !s.parentSessionId &&
          !s.isArchived &&
          (s.title?.trim().length ?? 0) > 0,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_RECENTS)
      .map((s) => ({ id: s.id, title: s.title!.trim() }))
  )
}

/**
 * Feed the desktop shell's File ▸ Open Recent menu with the most-recently-used
 * top-level chats. The Rust side rebuilds the native menu; clicking an entry opens
 * that session via the localix://session/<id> deep link.
 *
 * Mirrors {@link useDockBadge}: a desktop-only bridge that pushes derived store
 * state to a Tauri command. A JSON key guards against rebuilding the native menu
 * on every unrelated store tick (e.g. mid-stream) — we only re-push when the
 * recent list's content actually changes. No-op outside the desktop shell.
 */
export function useDockRecents(): void {
  const key = useChatStore((s) => JSON.stringify(selectRecents(s.allSessions)))

  useEffect(() => {
    if (!isDesktop) return
    // Recompute from the current snapshot (the key already gates on its content).
    const items = selectRecents(useChatStore.getState().allSessions)
    platformCapabilities()
      .desktop.invoke('set_recent_sessions', { items })
      ?.catch(() => {
        /* not the Tauri shell / command absent — ignore */
      })
  }, [key])
}
