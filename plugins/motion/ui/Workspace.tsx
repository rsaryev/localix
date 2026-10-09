import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Plus } from 'lucide-react'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { useStoreSnapshot } from '@localixai/plugin-sdk/ui/store-snapshot'
import type { PublishMessageContext } from '@localixai/plugin-sdk/ui'
import { librarySchema, type MotionProject, type TemplateId } from '../shared/schema'
import { templates } from '../shared/templates'
import { assetPayload } from './media'
import { ProjectEditor } from './ProjectEditor'
import { CreateVideoView } from './CreateVideoView'
import { MotionLibrary } from './MotionLibrary'
import { MediaLibrary } from './MediaLibrary'
import { MotionSessionContext, motionPath } from './scope'

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
  const source = useStoreSnapshot({
    plugin: 'motion',
    sessionId,
    path: motionPath(sessionId, '/rpc/motion/library'),
    schema: librarySchema,
    intervalMs: 3000,
    active,
    failureMessage: 'Motion Studio could not load. Try again.',
  })
  const send: typeof source.send = (body, options = {}) =>
    source.send(body, {
      ...options,
      path: motionPath(sessionId, options.path ?? '/rpc/motion/library'),
    })
  const [selected, setSelected] = useState<string | null>(initialId ?? null)
  const [creating, setCreating] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<{ id: string | null } | null>(null)
  const [deleting, setDeleting] = useState<MotionProject | null>(null)
  const [localError, setLocalError] = useState('')
  const project = source.snapshot?.projects.find((project) => project.id === selected)
  const navigate = (id: string | null) => {
    if (dirty) setPendingNavigation({ id })
    else setSelected(id)
  }
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), [])
  useEffect(() => {
    if (!project || !active) publishMessageContext?.(null)
  }, [project, active, publishMessageContext])
  const create = async (template: TemplateId) => {
    const state = await send(
      { template, title: templates[template].name },
      { path: '/rpc/motion/projects' },
    )
    if (state) setSelected(state.projects[state.projects.length - 1]!.id)
    return !!state
  }
  if (creating)
    return (
      <MotionSessionContext value={sessionId}>
        <div className="@container flex h-full min-h-0 min-w-0 flex-col">
          <CreateVideoView
            active={active}
            disabled={source.sending}
            onClose={() => setCreating(false)}
            onCreate={create}
            failure={source.error}
            onImport={async (document) => {
              const state = await send(
                { template: document.template, title: document.title, document },
                { path: '/rpc/motion/projects' },
              )
              if (state) setSelected(state.projects[state.projects.length - 1]!.id)
              return !!state
            }}
          />
        </div>
      </MotionSessionContext>
    )
  return (
    <MotionSessionContext value={sessionId}>
      <div className="@container flex h-full min-h-0 min-w-0 flex-col">
        <WorkbenchToolbar
          as="header"
          aria-label="Motion Studio navigation"
          wrap
          className="justify-between"
        >
          <h1 className="text-sm font-medium text-foreground">Motion Studio</h1>
          {project ? (
            <Button size="sm" variant="ghost" onClick={() => navigate(null)}>
              <ArrowLeft />
              Library
            </Button>
          ) : (
            !!source.snapshot?.projects.length && (
              <IconButton
                size="sm"
                aria-label="Create video"
                tooltip="Create video"
                onClick={() => setCreating(true)}
              >
                <Plus />
              </IconButton>
            )
          )}
        </WorkbenchToolbar>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 py-4 @2xl:px-6">
          {(source.error || localError) && (
            <div
              role="alert"
              className="mb-3 flex flex-wrap items-center gap-2 text-xs text-status-error"
            >
              <span>{localError || source.error}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setLocalError('')
                  source.refresh()
                }}
              >
                Try again
              </Button>
            </div>
          )}
          {!source.snapshot ? (
            <LoadingHint>Opening motion projects…</LoadingHint>
          ) : project ? (
            <ProjectEditor
              key={project.id}
              project={project}
              assets={source.snapshot.assets}
              active={active}
              sending={source.sending}
              onDirtyChange={onDirtyChange}
              publishMessageContext={publishMessageContext}
              onSave={async (revision, document) => {
                const state = await send(
                  { revision, document },
                  { path: `/rpc/motion/projects/${project.id}`, method: 'PUT' },
                )
                return state?.projects.find((item) => item.id === project.id) ?? null
              }}
              onUpload={async (file) => {
                try {
                  const state = await send(await assetPayload(file), { path: '/rpc/motion/assets' })
                  return state?.assets[state.assets.length - 1] ?? null
                } catch (error) {
                  setLocalError(error instanceof Error ? error.message : 'Upload failed.')
                  return null
                }
              }}
            />
          ) : (
            <>
              {selected && (
                <p role="status" className="mb-3 text-xs text-text-soft">
                  This video is no longer available. Choose another or create a video.
                </p>
              )}
              <MotionLibrary
                projects={source.snapshot.projects}
                disabled={source.sending}
                onOpen={navigate}
                onCreate={() => setCreating(true)}
                onDelete={setDeleting}
                onDuplicate={(project) => {
                  const document = {
                    ...project.document,
                    title: `${project.document.title.slice(0, 112)} copy`,
                  }
                  void send(
                    { template: document.template, title: document.title, document },
                    { path: '/rpc/motion/projects' },
                  ).then((state) => {
                    if (state) setSelected(state.projects[state.projects.length - 1]!.id)
                  })
                }}
              />
              {!!source.snapshot.projects.length && (
                <div className="mt-6 space-y-3">
                  <MediaLibrary
                    assets={source.snapshot.assets}
                    disabled={source.sending}
                    onRemove={(id) => {
                      void send({}, { path: `/rpc/motion/assets/${id}`, method: 'DELETE' })
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>
        <ConfirmDialog
          open={pendingNavigation !== null}
          title="Discard unsaved changes?"
          description="Your saved video stays in the library. The unsaved draft will be discarded."
          confirmLabel="Discard draft"
          onClose={() => setPendingNavigation(null)}
          onConfirm={() => {
            setSelected(pendingNavigation?.id ?? null)
            setDirty(false)
            setPendingNavigation(null)
          }}
        />
        <ConfirmDialog
          open={deleting !== null}
          title="Delete this video?"
          description="The saved project will be removed. Uploaded media stays available for other videos."
          confirmLabel="Delete video"
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            if (deleting)
              void send(
                { revision: deleting.revision },
                { path: `/rpc/motion/projects/${deleting.id}`, method: 'DELETE' },
              )
            setDeleting(null)
          }}
        />
      </div>
    </MotionSessionContext>
  )
}
