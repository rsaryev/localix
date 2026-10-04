import { Plus } from 'lucide-react'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import type { Project } from '@/shared/api/contracts'
import { PROJECT_ICON, projectPresentation } from '@/shared/ui/projectPresentation'
import { HeaderPickMenu } from './HeaderPickMenu'

/** One project as a `selected` row, drawn from the shared project presentation. */
function projectEntry(
  project: Project | null,
  activeId: string | null,
  onSelect: (id: string) => void,
): MenuEntry {
  const id = project?.id ?? ''
  const { label, icon } = projectPresentation(project)
  return {
    id: `project:${id}`,
    label,
    icon,
    selected: id === activeId,
    onSelect: () => {
      if (id !== activeId) onSelect(id)
    },
  }
}

interface ProjectSwitcherProps {
  projects: Project[]
  /** '' = no project, otherwise a project id. */
  project: string
  onChange: (project: string) => void
}

/**
 * WHERE things are installed — the project whose skills, MCP servers and plugins are listed.
 *
 * It used to answer a second question too: which SCOPE's permission rules you were editing,
 * with agents in the same dropdown and "No project" reading as a third scope. Rules belong to
 * an agent now and to nothing else, so a project sitting in that list was claiming an
 * authority it never had. Picking the agent is {@link AgentSwitcher}'s job.
 *
 * "No project" stays, because it is a real place: `~/.localix/plugins` holds the plugins that
 * belong to no project, and a skill can live there too.
 */
export function ProjectSwitcher({ projects, project, onChange }: ProjectSwitcherProps) {
  const current = projects.find((entry) => entry.id === project) ?? null
  const { label, icon } = projectPresentation(current)
  return (
    <HeaderPickMenu
      label="Project"
      icon={icon}
      text={label}
      entries={[
        projectEntry(null, project, onChange),
        ...projects.map((entry) => projectEntry(entry, project, onChange)),
      ]}
    />
  )
}

/**
 * Which project the Project tab shows — or a new one.
 *
 * It was an outline button over Radix radio items, with a bare paragraph for the empty case:
 * a second way to draw "one of these" beside every other menu in the app. Now it is the same
 * quiet pick as the switcher above, the empty case a disabled row that says so, and "New
 * project" an action row after the choices.
 */
export function ProjectScopeSelect({
  projects,
  activeId,
  onSelect,
  onCreate,
}: {
  projects: Project[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
}) {
  const active = projects.find((p) => p.id === activeId)
  const entries: MenuEntry[] = [
    ...(projects.length > 0
      ? projects.map((entry) => projectEntry(entry, activeId, onSelect))
      : [{ id: 'empty', label: 'No projects yet', disabled: true, onSelect: () => {} }]),
    { separator: true },
    { id: 'new', label: 'New project', icon: Plus, onSelect: onCreate },
  ]
  return (
    <HeaderPickMenu
      label="Project"
      icon={PROJECT_ICON}
      text={active?.name ?? 'Select project'}
      entries={entries}
      align="start"
    />
  )
}
