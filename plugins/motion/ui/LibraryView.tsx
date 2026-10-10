import { Film, Plus, Trash2 } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { EmptyHint } from '@localixai/kit/empty-hint'
import {
  WorkbenchListRow,
  WorkbenchListRowActions,
  WorkbenchListRowLeading,
  WorkbenchListRowMeta,
  WorkbenchListRowText,
  WorkbenchListRowTrigger,
} from '@localixai/kit/workbench-list-row'
import { formatTimeAgo } from '@localixai/plugin-sdk/ui/utilities'
import type { MotionProject } from '../shared/contract'
import { styleById } from '../shared/styles'
import { formatName, formatSeconds, newestFirst, sceneCount } from './format'

/**
 * Films in this conversation's workspace, newest first. Empty, the view is one quiet action in
 * the centre that opens the directions; films themselves are made and changed in chat.
 */
export function LibraryView({
  projects,
  disabled,
  missing,
  onNew,
  onOpen,
  onDelete,
}: {
  projects: MotionProject[]
  disabled: boolean
  /** The film this view was opened for no longer exists. */
  missing: boolean
  onNew: () => void
  onOpen: (id: string) => void
  onDelete: (project: MotionProject) => void
}) {
  if (!projects.length)
    return (
      <div className="flex min-h-80 flex-1 items-center justify-center">
        <EmptyHint className="gap-3">
          <IconButton size="touch" aria-label="New film" tooltip="New film" onClick={onNew}>
            <Plus />
          </IconButton>
        </EmptyHint>
      </div>
    )
  return (
    <div className="space-y-1">
      {missing && (
        <p role="status" className="mb-2 text-xs text-text-soft">
          That film is no longer in this conversation. Choose another one.
        </p>
      )}
      <div aria-label="Films" role="list" className="space-y-0.5">
        {newestFirst(projects).map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            disabled={disabled}
            onOpen={onOpen}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  )
}

function ProjectRow({
  project,
  disabled,
  onOpen,
  onDelete,
}: {
  project: MotionProject
  disabled: boolean
  onOpen: (id: string) => void
  onDelete: (project: MotionProject) => void
}) {
  const latest = newestFirst(project.renders)[0]
  const description = [
    styleById(project.style ?? '')?.name,
    formatName(project),
    sceneCount(project.scenes),
    latest ? `rendered ${formatTimeAgo(Date.parse(latest.updatedAt))}` : 'not rendered',
  ]
    .filter(Boolean)
    .join(' · ')
  const job = project.job?.state === 'running' ? project.job : null
  const status = job
    ? `${job.kind === 'render' ? 'Rendering' : job.kind === 'snapshot' ? 'Snapshots' : 'Checking'}${job.progress === null ? '…' : ` ${Math.round(job.progress)}%`}`
    : formatSeconds(project.duration)
  return (
    <WorkbenchListRow role="listitem">
      <WorkbenchListRowTrigger onClick={() => onOpen(project.id)}>
        <WorkbenchListRowLeading>
          <Film className="size-4" />
        </WorkbenchListRowLeading>
        <WorkbenchListRowText title={project.title} description={description} />
      </WorkbenchListRowTrigger>
      <WorkbenchListRowMeta className={job ? 'text-status-info' : undefined}>
        {status}
      </WorkbenchListRowMeta>
      <WorkbenchListRowActions aria-label={`Actions for ${project.title}`} visibility="hover">
        <IconButton
          size="xs"
          aria-label={`Delete ${project.title}`}
          tooltip="Delete film"
          disabled={disabled || !!job}
          onClick={() => onDelete(project)}
        >
          <Trash2 />
        </IconButton>
      </WorkbenchListRowActions>
    </WorkbenchListRow>
  )
}
