import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { backendClient } from '@/shared/api/client'
import { useRoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { useChatStore } from './store'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

/** Normalize a working-dir path for comparison (slashes + trailing slash). */
function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Shared "Add folder…" flow used by the sidebar and the composer context bar:
 * open the native directory picker, then SWITCH to the matching project if one
 * already exists, else CREATE a project for that folder and switch to it. One
 * source of truth so the two entry points can never drift.
 */
export function useAddProjectFolder(): () => Promise<void> {
  const nav = useRoutedNavigation()
  const { projects, createProject } = useChatStore(
    useShallow((s) => ({ projects: s.projects, createProject: s.createProject })),
  )

  return useCallback(async () => {
    try {
      const dir = await backendClient.pickDirectory()
      if (!dir) return

      const normalized = normalizeDir(dir)
      const existing = projects.find((p) => normalizeDir(p.workingDir) === normalized)
      if (existing) {
        nav.switchProject(existing.id)
        return
      }

      const parts = normalized.split('/')
      const folderName = parts[parts.length - 1] || 'New Project'
      const project = await createProject(folderName, dir)
      nav.switchProject(project.id)
    } catch (error) {
      toast.error('Could not add the project folder', {
        description: errorMessage(error, '') || undefined,
      })
    }
  }, [projects, createProject, nav])
}
