import { Copy, Film, Plus, Trash2 } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { EmptyHint } from '@localixai/kit/empty-hint'
import {
  WorkbenchListRow,
  WorkbenchListRowTrigger,
  WorkbenchListRowText,
  WorkbenchListRowMeta,
  WorkbenchListRowActions,
} from '@localixai/kit/workbench-list-row'
import { templates } from '../shared/templates'
import { durationOf } from '../shared/timing'
import type { MotionProject } from '../shared/schema'

export function MotionLibrary({
  projects,
  disabled,
  onOpen,
  onCreate,
  onDuplicate,
  onDelete,
}: {
  projects: MotionProject[]
  disabled: boolean
  onOpen: (id: string) => void
  onCreate: () => void
  onDuplicate: (project: MotionProject) => void
  onDelete: (project: MotionProject) => void
}) {
  if (!projects.length)
    return (
      <div className="flex min-h-80 flex-1 items-center justify-center">
        <EmptyHint className="gap-3">
          <IconButton
            size="touch"
            aria-label="Create video"
            tooltip="Create video"
            onClick={onCreate}
          >
            <Plus />
          </IconButton>
        </EmptyHint>
      </div>
    )
  return (
    <div aria-label="Motion projects" className="space-y-1">
      {projects.map((project) => (
        <WorkbenchListRow key={project.id}>
          <WorkbenchListRowTrigger onClick={() => onOpen(project.id)}>
            <Film className="size-4 shrink-0 text-text-faint" />
            <WorkbenchListRowText
              title={project.document.title}
              description={`${templates[project.document.template].category} · ${project.document.scenes.length} scenes`}
            />
          </WorkbenchListRowTrigger>
          <WorkbenchListRowMeta>{durationOf(project.document).toFixed(1)}s</WorkbenchListRowMeta>
          <WorkbenchListRowActions aria-label={`Actions for ${project.document.title}`}>
            <IconButton
              size="xs"
              tooltip="Duplicate video"
              aria-label={`Duplicate ${project.document.title}`}
              disabled={disabled}
              onClick={() => onDuplicate(project)}
            >
              <Copy />
            </IconButton>
            <IconButton
              size="xs"
              tooltip="Delete video"
              aria-label={`Delete ${project.document.title}`}
              disabled={disabled}
              onClick={() => onDelete(project)}
            >
              <Trash2 />
            </IconButton>
          </WorkbenchListRowActions>
        </WorkbenchListRow>
      ))}
    </div>
  )
}
