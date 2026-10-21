import type { Project } from '@/shared/api/contracts'
import { Button } from '@localixai/kit/button'
import { ComposerChip } from '@localixai/kit/composer-chip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import {
  ADD_PROJECT_FOLDER,
  PROJECT_ICON,
  projectPresentation,
} from '@/shared/ui/projectPresentation'

/** One folder picker presentation; each surface supplies its own navigation actions. */
export function ProjectFolderMenu({
  projects,
  activeProjectId,
  onPick,
  onAddFolder,
  disabled = false,
  presentation = 'chip',
}: {
  projects: readonly Project[]
  activeProjectId: string | null
  onPick: (id: string) => void
  onAddFolder: () => void
  disabled?: boolean
  presentation?: 'chip' | 'toolbar'
}) {
  const active = projects.find((project) => project.id === activeProjectId)
  const { label, icon: Icon } = projectPresentation(active)
  const content = (
    <>
      <Icon className="size-3.5 shrink-0 opacity-70" />
      <span className="truncate font-medium">{label}</span>
    </>
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {presentation === 'chip' ? (
          <ComposerChip
            aria-label={`Project: ${label}`}
            title={active?.workingDir ?? 'Choose a working folder'}
            disabled={disabled}
          >
            {content}
          </ComposerChip>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 max-w-64 text-text-soft"
            aria-label="Working folder"
            title={active?.workingDir}
            disabled={disabled}
          >
            {content}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side={presentation === 'chip' ? 'top' : 'bottom'}
        className="max-h-52 w-64 overflow-y-auto"
      >
        <MenuEntries
          family="dropdown"
          entries={[
            {
              id: 'add-folder',
              label: ADD_PROJECT_FOLDER.label,
              icon: ADD_PROJECT_FOLDER.icon,
              onSelect: onAddFolder,
            },
            { separator: true },
            { header: 'Projects' },
            ...projects.map((project) => ({
              id: project.id,
              label: project.name,
              icon: PROJECT_ICON,
              selected: project.id === activeProjectId,
              onSelect: () => onPick(project.id),
            })),
            ...(projects.length
              ? []
              : [{ id: 'empty', label: 'No projects yet', disabled: true, onSelect: () => {} }]),
          ]}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
