import { lazy, Suspense, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react'
import { useNativeEditTarget, isPrimaryModifier } from '@localixai/kit/keybindings'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { WorkbenchStatusBar, WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import type { ResumeDocument, ResumeSummary } from '../shared/schema'
import { useResumes } from './useResumes'
import { resumeMessageContext } from './bindings'
import { WorkspaceActions } from './WorkspaceActions'
import { WorkspaceNotices } from './WorkspaceNotices'
import { HistoryPanel } from './HistoryPanel'
import { ValidationScope, documentErrors } from './validation'
import { ResumeCanvas } from './ResumeCanvas'
import { ResumeLibrary } from './ResumeLibrary'
import { downloadResume } from './export'
import { resumeApi } from './api'
const CreateResumeDialog = lazy(() =>
  import('./CreateResumeDialog').then((module) => ({ default: module.CreateResumeDialog })),
)

export function Workspace({
  active,
  sessionId,
  initialId,
  initialSectionId,
  publishMessageContext,
}: {
  active: boolean
  sessionId: string
  initialId?: string
  initialSectionId?: string
  publishMessageContext?: PublishMessageContext
}) {
  const state = useResumes(active, sessionId, initialId)
  const [sectionId, setSectionId] = useState<string | null>(initialSectionId ?? null)
  const [library, setLibrary] = useState(!initialId)
  const [creating, setCreating] = useState<'blank' | 'sample' | 'import' | null>(null)
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [previewChoice, setPreviewChoice] = useState<boolean | null>(null)
  const [wide, setWide] = useState(false)
  const preview = previewChoice ?? wide
  const previewId = useId()
  const [exporting, setExporting] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useNativeEditTarget(root, (command) => {
    if (!active || state.pending || library) return
    if (command === 'undo') state.undo()
    else if (command === 'redo') state.redo()
  })
  // Undo/redo chords, heard on the workspace element itself: it is a group landmark, not a control,
  // so the listener is attached to the DOM handle instead of as a JSX handler.
  const onShortcutKey = useEffectEvent((event: KeyboardEvent) => {
    if (!active || state.pending || !isPrimaryModifier(event) || event.altKey) return
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('input, textarea, [contenteditable="true"]')
    )
      return
    const key = event.key.toLowerCase()
    if (key !== 'z' && key !== 'y') return
    event.preventDefault()
    if (key === 'y' || event.shiftKey) state.redo()
    else state.undo()
  })
  useEffect(() => {
    const element = root.current
    if (!element) return
    const listener = (event: KeyboardEvent) => onShortcutKey(event)
    element.addEventListener('keydown', listener)
    return () => element.removeEventListener('keydown', listener)
  }, [])
  const { draft, base } = state
  const section = draft?.sections.find((item) => item.id === sectionId)
  const context = useMemo(
    () =>
      base && draft && !library
        ? resumeMessageContext(base, draft, section?.id ?? null, state.dirty)
        : null,
    [base, draft, section?.id, state.dirty, library],
  )
  useEffect(() => {
    if (showHistory && active && !library) return
    publishMessageContext?.(active ? context : null)
    return () => publishMessageContext?.(null)
  }, [publishMessageContext, context, showHistory, active, library])
  const change = (value: ResumeDocument) => {
    state.setDraft(value)
    setConfirm(null)
  }
  const exportResume = async (
    resume: ResumeSummary,
    format: Parameters<typeof downloadResume>[1],
  ) => {
    try {
      await downloadResume(await resumeApi.get(sessionId, resume.id), format, sessionId)
    } catch (error) {
      state.setError(error instanceof Error ? error.message : 'Export failed. Retry.')
    }
  }
  const exportFile = async (format: Parameters<typeof downloadResume>[1]) => {
    if (!base || state.dirty || exporting) return
    setExporting(true)
    try {
      await downloadResume(base, format, sessionId)
    } catch (error) {
      state.setError(
        error instanceof Error ? error.message : 'Export failed. Retry or export Markdown.',
      )
    } finally {
      setExporting(false)
    }
  }
  return (
    <ValidationScope errors={state.validationVisible && draft ? documentErrors(draft) : {}}>
      <div
        ref={root}
        role="group"
        aria-label="Resume workspace"
        className="@container flex h-full min-h-0 min-w-0 flex-col"
      >
        {!library && base && draft && (
          <WorkspaceActions
            state={state}
            setConfirm={setConfirm}
            preview={preview}
            previewId={previewId}
            onTogglePreview={() => {
              setShowHistory(false)
              setPreviewChoice(!preview)
            }}
            exporting={exporting}
            exportFile={exportFile}
            onHistory={() => setShowHistory(true)}
            onNew={() => setCreating('blank')}
            onImport={() => setCreating('import')}
            onLibrary={() => {
              setLibrary(true)
              setShowHistory(false)
            }}
          />
        )}
        <WorkspaceNotices state={state} confirm={confirm} setConfirm={setConfirm} />
        {showHistory && base && active && !library ? (
          <HistoryPanel
            key={base.id}
            sessionId={sessionId}
            resume={base}
            dirty={state.dirty}
            pending={state.pending}
            onRestore={state.restore}
            onClose={() => setShowHistory(false)}
            publishMessageContext={publishMessageContext}
          />
        ) : state.loading && !base ? (
          <LoadingHint>Opening resumes…</LoadingHint>
        ) : library || !draft || !base ? (
          <ResumeLibrary
            onRename={state.renameResume}
            onDelete={state.deleteResume}
            onDuplicate={state.duplicateResume}
            onExport={(resume, format) => void exportResume(resume, format)}
            resumes={state.resumes}
            pending={state.pending}
            onCreate={() => setCreating('blank')}
            onBrowse={() => setCreating('sample')}
            onOpen={(resume) => {
              state.select(resume)
              setSectionId(null)
              setLibrary(false)
            }}
          />
        ) : (
          <ResumeCanvas
            active={active}
            onWideChange={setWide}
            preview={preview}
            previewId={previewId}
            document={draft}
            onChange={change}
            sectionId={sectionId}
            onSection={setSectionId}
            pending={state.pending}
          />
        )}
        {!library && (
          <WorkbenchStatusBar aria-label="Resume status">
            <WorkbenchStatusItem>
              <span role="status">
                {state.pending
                  ? 'Saving'
                  : state.dirty
                    ? 'Unsaved draft · save before exporting'
                    : base
                      ? 'Saved'
                      : 'Local resume library'}
              </span>
            </WorkbenchStatusItem>
            {draft && <WorkbenchStatusItem>{draft.sections.length} sections</WorkbenchStatusItem>}
          </WorkbenchStatusBar>
        )}
        {creating && (
          <Suspense fallback={<LoadingHint>Opening creation form…</LoadingHint>}>
            <CreateResumeDialog
              key={creating}
              open
              initialSource={creating}
              pending={state.pending}
              onClose={() => setCreating(null)}
              onCreate={async (document) => {
                const created = await state.createDocument(document)
                if (created) {
                  setLibrary(false)
                  setSectionId(null)
                  setShowHistory(false)
                }
                return created
              }}
            />
          </Suspense>
        )}
      </div>
    </ValidationScope>
  )
}
