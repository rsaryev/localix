import { useEffect, useState } from 'react'
import { ArrowLeft, Plus } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { resourceMessageBindingDraft, type PublishMessageContext } from '@localixai/plugin-sdk/ui'
import { useStoreSnapshot } from '@localixai/plugin-sdk/ui/store-snapshot'
import {
  librarySchema,
  motionUri,
  type MotionLibrary,
  type MotionProject,
} from '../shared/contract'
import type { MotionStyle } from '../shared/styles'
import { LibraryView } from './LibraryView'
import { ProjectView } from './ProjectView'
import { StyleGallery } from './StyleGallery'
import { StyleView } from './StyleView'
import { motionPath } from './scope'

export function Workspace({
  active = true,
  sessionId,
  initialId,
  publishMessageContext,
}: {
  active?: boolean
  sessionId: string
  initialId?: string
  publishMessageContext?: PublishMessageContext
}) {
  const [selected, setSelected] = useState<string | null>(initialId ?? null)
  const [style, setStyle] = useState<MotionStyle | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [deleting, setDeleting] = useState<MotionProject | null>(null)
  const [jobRunning, setJobRunning] = useState(false)
  const source = useStoreSnapshot({
    plugin: 'motion',
    sessionId,
    path: motionPath(sessionId, '/rpc/motion/library'),
    schema: librarySchema,
    intervalMs: 3000,
    // A running CLI job reports progress faster than files change: follow it closely.
    backstopMs: jobRunning ? 1000 : null,
    active,
    failureMessage: 'Motion Studio could not load. Try again.',
  })
  const library = source.snapshot
  const running = !!library?.projects.some((project) => project.job?.state === 'running')
  useEffect(() => setJobRunning(running), [running])
  const project = library?.projects.find((item) => item.id === selected)
  const send = (body: unknown, path: string, method: 'POST' | 'DELETE' = 'POST') =>
    source.send(body, { path: motionPath(sessionId, path), method })

  const openId = project?.id
  const openTitle = project?.title
  useEffect(() => {
    if (!openId || !openTitle || !active) {
      publishMessageContext?.(null)
      return
    }
    publishMessageContext?.({
      strategy: 'replace',
      bindings: [resourceMessageBindingDraft({ uri: motionUri(openId), label: openTitle })],
    })
  }, [active, openId, openTitle, publishMessageContext])
  useEffect(() => () => publishMessageContext?.(null), [publishMessageContext])

  // "Use direction": fork it into the workspace and open the new film.
  const use = async (direction: MotionStyle) => {
    const state: MotionLibrary | null = await send(
      { direction: direction.id },
      '/rpc/motion/projects',
    )
    if (!state?.focus) return
    setStyle(null)
    setBrowsing(false)
    setSelected(state.focus)
  }
  return (
    <div className="@container flex h-full min-h-0 min-w-0 flex-col">
      {source.error && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-soft px-4 py-1.5 text-xs text-status-error"
        >
          <span className="min-w-0 flex-1">{source.error}</span>
          <Button size="xs" variant="ghost" onClick={source.refresh}>
            Try again
          </Button>
        </div>
      )}
      {!library ? (
        <LoadingHint>Opening Motion Studio…</LoadingHint>
      ) : project ? (
        <ProjectView
          key={project.id}
          sessionId={sessionId}
          project={project}
          tooling={library.tooling}
          sending={source.sending}
          onBack={() => setSelected(null)}
          onRender={(settings) => void send(settings, `/rpc/motion/projects/${project.id}/render`)}
          onCancel={() => void send({}, `/rpc/motion/projects/${project.id}/cancel`)}
          onDelete={() => setDeleting(project)}
        />
      ) : style ? (
        <StyleView
          style={style}
          creating={source.sending}
          onBack={() => setStyle(null)}
          onUse={() => void use(style)}
        />
      ) : browsing ? (
        <>
          <WorkbenchToolbar as="header" aria-label="New film">
            <Button size="sm" variant="ghost" onClick={() => setBrowsing(false)}>
              <ArrowLeft data-icon="inline-start" />
              Films
            </Button>
            <h1 className="text-sm font-medium text-foreground">Choose a direction</h1>
          </WorkbenchToolbar>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 py-4 @2xl:px-6">
            <StyleGallery onOpen={setStyle} />
          </div>
        </>
      ) : (
        <>
          <WorkbenchToolbar as="header" aria-label="Motion Studio" className="justify-between">
            <h1 className="text-sm font-medium text-foreground">Motion Studio</h1>
            {!!library.projects.length && (
              <IconButton
                size="sm"
                aria-label="New film"
                tooltip="New film"
                onClick={() => setBrowsing(true)}
              >
                <Plus />
              </IconButton>
            )}
          </WorkbenchToolbar>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 py-4 @2xl:px-6">
            <LibraryView
              projects={library.projects}
              disabled={source.sending}
              missing={selected !== null}
              onNew={() => setBrowsing(true)}
              onOpen={setSelected}
              onDelete={setDeleting}
            />
          </div>
        </>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this film?"
        description={
          deleting
            ? `${deleting.path} will be removed with its scenes, assets, snapshots and renders.`
            : undefined
        }
        confirmLabel="Delete film"
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) {
            if (deleting.id === selected) setSelected(null)
            void send({}, `/rpc/motion/projects/${deleting.id}`, 'DELETE')
          }
          setDeleting(null)
        }}
      />
    </div>
  )
}
