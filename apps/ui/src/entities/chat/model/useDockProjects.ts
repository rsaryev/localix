import { useEffect } from 'react'
import { isDesktop } from '@localixai/kit/environment'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { useChatStore } from './store'

/** How many projects to surface in the native Project menu (most-recent first). */
const MAX_PROJECTS = 12

/**
 * Feed the desktop shell's Project menu with the opened projects (most-recent
 * first) plus the active project id. The Rust side rebuilds the native menu so
 * the submenu lists them (active one checkmarked); clicking an entry switches to
 * that project via the localix://project/<id> deep link.
 *
 * Mirrors {@link useDockRecents}: a desktop-only bridge pushing derived store
 * state to a Tauri command. A JSON key gates the push so the native menu is only
 * rebuilt when the project list or active project actually changes. No-op outside
 * the desktop shell.
 */
export function useDockProjects(): void {
  const key = useChatStore((s) =>
    JSON.stringify({
      items: s.projects
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, MAX_PROJECTS)
        .map((p) => ({ id: p.id, name: p.name })),
      active: s.activeProjectId,
    }),
  )

  useEffect(() => {
    if (!isDesktop) return
    const { items, active } = JSON.parse(key) as {
      items: Array<{ id: string; name: string }>
      active: string | null
    }
    platformCapabilities()
      .desktop.invoke('set_projects', { items, active })
      ?.catch(() => {
        /* not the Tauri shell / command absent — ignore */
      })
  }, [key])
}
