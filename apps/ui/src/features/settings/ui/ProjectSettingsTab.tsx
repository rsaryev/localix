import { useEffect, useState, type ReactNode } from 'react'
import type { Project } from '@/shared/api/contracts'
import { ProjectSettingsForm } from './ProjectsSettings'
import { SettingsPage } from './SettingsScaffold'

/** The Project tab: the settings of the project it names, from the live project list. */
export function ProjectSettingsTab({
  projects,
  activeId,
  picker,
  onClose,
}: {
  projects: readonly Project[]
  activeId: string | null | undefined
  /** Which project these settings apply to: the page header's action, as every page's own. */
  picker: ReactNode
  /** Leave the tab: the project was deleted here or elsewhere. */
  onClose: () => void
}) {
  const project = projects.find((candidate) => candidate.id === activeId)
  // Removed while its settings were open — elsewhere, or by an agent — the tab steps back as a
  // delete here does; a tab opened at no listed project asks for one.
  const [shown, setShown] = useState<string | undefined>()
  if (project && shown !== project.id) setShown(project.id)
  const removed = !project && shown !== undefined && shown === activeId
  useEffect(() => {
    if (removed) onClose()
  }, [removed, onClose])
  if (removed) return null
  return project ? (
    <ProjectSettingsForm key={project.id} project={project} picker={picker} onDeleted={onClose} />
  ) : (
    <SettingsPage title="Project" description="Select a project, or create one." actions={picker}>
      {null}
    </SettingsPage>
  )
}
