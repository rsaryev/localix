import { lazy, Suspense, useState } from 'react'
import { ArrowLeft, Ellipsis, Trash2 } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import type { MotionLibrary, MotionProject } from '../shared/contract'
import { styleById } from '../shared/styles'
import { ChoiceMenu } from './ChoiceMenu'
import { formatName, formatSeconds, sceneCount } from './format'
import { JobStatus, ToolingNotice } from './JobStatus'
import { IssuesNotice, RenderStrip, StillStrip } from './ProjectSections'
import { RenderMenu, type RenderSettings } from './RenderMenu'
import { projectFileUrl } from './scope'

const FilmPlayer = lazy(() =>
  import('./FilmPlayer').then((module) => ({ default: module.FilmPlayer })),
)

/**
 * One film: the player is the whole view. Problems, renders and the agent's review stills appear
 * only when there are some; the story itself is changed in chat.
 */
export function ProjectView({
  sessionId,
  project,
  tooling,
  sending,
  onBack,
  onRender,
  onCancel,
  onDelete,
}: {
  sessionId: string
  project: MotionProject
  tooling: MotionLibrary['tooling']
  sending: boolean
  onBack: () => void
  onRender: (settings: RenderSettings) => void
  onCancel: () => void
  onDelete: () => void
}) {
  /** A render (`renders/<name>`) on the stage instead of the live composition. */
  const [viewing, setViewing] = useState<string | null>(null)
  const render = viewing ? project.renders.find((file) => file.path.endsWith(viewing)) : undefined
  const running = project.job?.state === 'running'
  const toolsReady = !!tooling.node && tooling.ffmpeg
  const meta = [
    styleById(project.style ?? '')?.name,
    formatName(project),
    formatSeconds(project.duration),
    sceneCount(project.scenes),
  ]
    .filter(Boolean)
    .join(' · ')
  const ratio = project.width / project.height
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <WorkbenchToolbar as="header" aria-label="Film actions">
        <WorkbenchToolbarSection className="min-w-0 flex-1">
          <IconButton size="sm" aria-label="Back to films" tooltip="Films" onClick={onBack}>
            <ArrowLeft />
          </IconButton>
          <h1 className="truncate text-sm font-medium text-foreground">{project.title}</h1>
          <span className="hidden truncate text-2xs text-text-faint @lg:inline">{meta}</span>
        </WorkbenchToolbarSection>
        <WorkbenchToolbarSection align="end" spacing="compact">
          <RenderMenu disabled={sending || running || !toolsReady} onRender={onRender} />
          <ChoiceMenu
            label="More film actions"
            icon={<Ellipsis />}
            align="end"
            entries={[
              {
                id: 'delete',
                label: 'Delete film…',
                icon: Trash2,
                danger: true,
                disabled: running,
                onSelect: onDelete,
              },
            ]}
          />
        </WorkbenchToolbarSection>
      </WorkbenchToolbar>
      <JobStatus job={project.job} cancelling={sending} onCancel={onCancel} />
      <ToolingNotice tooling={tooling} />
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto overflow-x-hidden px-4 py-5 @2xl:px-8">
        {/* The stage fits the pane: as wide as allowed, never taller than the space left. */}
        <div
          className="flex w-full flex-col gap-3"
          style={{ maxWidth: `min(100%, calc((100dvh - 16rem) * ${ratio}))` }}
        >
          <IssuesNotice issues={project.issues} />
          <Suspense fallback={<LoadingHint className="min-h-64">Loading the player…</LoadingHint>}>
            {render && viewing ? (
              <FilmPlayer
                key={render.path}
                src={projectFileUrl(sessionId, project, viewing)}
                type={render.name.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4'}
                width={project.width}
                height={project.height}
                label={`Render ${render.name}`}
                reloadKey={render.updatedAt}
              />
            ) : (
              <FilmPlayer
                src={projectFileUrl(sessionId, project)}
                width={project.width}
                height={project.height}
                label={`Preview of ${project.title}`}
                reloadKey={project.revision}
                startAt={Math.min(2, (project.duration ?? 10) * 0.15)}
              />
            )}
          </Suspense>
          {render && (
            <div className="flex items-center justify-between gap-2 text-2xs text-text-faint">
              <span className="truncate">Playing the render {render.name}</span>
              <Button size="xs" variant="ghost" onClick={() => setViewing(null)}>
                Back to live preview
              </Button>
            </div>
          )}
          <RenderStrip
            sessionId={sessionId}
            project={project}
            viewing={viewing}
            onView={setViewing}
          />
          <StillStrip sessionId={sessionId} project={project} />
        </div>
      </div>
    </div>
  )
}
