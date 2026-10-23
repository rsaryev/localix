import { useEffect, useState } from 'react'
import type { Project } from '@localixai/api/client'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { backendClient } from '@/shared/api/client'
import { useResourceRevision } from '@/shared/api/useResourceRevision'
import { reportProjectListFailure, reportProjectListLoaded } from './projectListProblem'

/**
 * The project list a settings page names scopes with. Read while the page is visible, and again
 * whenever the server's 'projects' topic says the list changed, so a project created or renamed
 * elsewhere shows up without reopening the page. `report` surfaces a failed read as the shared
 * settings problem; a page that only needs labels passes false.
 */
export function useSettingsProjects({ report = true }: { report?: boolean } = {}): Project[] {
  const visible = useWorkItemVisible()
  const revision = useResourceRevision('projects', visible)
  const [projects, setProjects] = useState<Project[]>([])
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    backendClient
      .listProjects()
      .then((rows) => {
        if (report) reportProjectListLoaded()
        if (!cancelled) setProjects(rows)
      })
      .catch((error: unknown) => {
        if (report) reportProjectListFailure(error)
      })
    return () => {
      cancelled = true
    }
  }, [visible, revision, report])
  return projects
}
