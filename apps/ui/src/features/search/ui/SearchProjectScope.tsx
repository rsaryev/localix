import { ChevronDown } from 'lucide-react'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { ALL_PROJECTS, type ProjectScope } from '../model/useGlobalSearch'
import type { SearchProjectOption } from '../model/useSearchProject'

/**
 * Where the search looks, said at the end of the field: the current project by name (the
 * default, listed first), another project, or every project — one choice among them, drawn as the
 * kit's `selected` rows. Chats, messages and a project's own capabilities follow it; what belongs
 * to no project (projects, settings, models) is searched either way.
 */
export function SearchProjectScope({
  currentProjectId,
  projects,
  scope,
  onChange,
}: {
  /** The chat's project; null for a chat outside any project. */
  currentProjectId: string | null
  projects: readonly SearchProjectOption[]
  scope: ProjectScope
  onChange: (scope: ProjectScope) => void
}) {
  const nameOf = (id: string | null) =>
    id ? (projects.find((project) => project.id === id)?.name ?? id) : 'No project'
  const others = projects
    .filter((project) => project.id !== currentProjectId)
    .sort((a, b) => a.name.localeCompare(b.name))
  const shown = scope === ALL_PROJECTS ? 'All projects' : nameOf(scope ?? currentProjectId)
  const entries: MenuEntry[] = [
    {
      id: 'current',
      label: nameOf(currentProjectId),
      selected: scope === null,
      onSelect: () => onChange(null),
    },
    ...others.map((project) => ({
      id: `project:${project.id}`,
      label: project.name,
      selected: scope === project.id,
      onSelect: () => onChange(project.id),
    })),
    { separator: true },
    {
      id: 'all',
      label: 'All projects',
      selected: scope === ALL_PROJECTS,
      onSelect: () => onChange(ALL_PROJECTS),
    },
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Search in: ${shown}`}
        className="flex max-w-40 shrink-0 items-center gap-0.5 rounded-sm px-1 text-2xs text-text-faint outline-none transition-colors hover:text-foreground focus-ring data-[state=open]:text-foreground"
      >
        <span className="truncate">{shown}</span>
        <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 min-w-44 overflow-y-auto">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
