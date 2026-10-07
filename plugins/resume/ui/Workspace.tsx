import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { WorkbenchStatusBar, WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'
import type { PublishMessageContext } from '@localixai/plugin-sdk/ui'
import type { ResumeDocument } from '../shared/schema'
import { useResumes } from './useResumes'
import { resumeMessageContext } from './bindings'
import { WorkspaceActions } from './WorkspaceActions'
import { WorkspaceNotices } from './WorkspaceNotices'
import { HistoryPanel } from './HistoryPanel'
import { ValidationScope, documentErrors } from './validation'
import { Preview } from './Preview'
import { ResumeLibrary } from './ResumeLibrary'
import { downloadResume } from './export'
import { resumeApi } from './api'
const EditorPanel = lazy(() =>
  import('./EditorPanel').then((module) => ({ default: module.EditorPanel })),
)
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
  const [creating, setCreating] = useState<'blank' | 'sample' | null>(null)
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null)
  const [importing, setImporting] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [exporting, setExporting] = useState(false)
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
      <div className="@container flex h-full min-h-0 flex-col">
        {!library && base && draft && (
          <WorkspaceActions
            state={state}
            setConfirm={setConfirm}
            importing={importing}
            setImporting={setImporting}
            exporting={exporting}
            exportFile={exportFile}
            onHistory={() => setShowHistory(true)}
            onNew={() => setCreating('blank')}
            onLibrary={() => {
              setLibrary(true)
              setShowHistory(false)
            }}
          />
        )}
        <WorkspaceNotices
          state={state}
          confirm={confirm}
          setConfirm={setConfirm}
          importing={importing}
          setImporting={setImporting}
        />
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
            sessionId={sessionId}
            onRename={state.renameResume}
            onDelete={state.deleteResume}
            onDuplicate={state.duplicateResume}
            onExport={async (resume, format) => {
              try {
                await downloadResume(await resumeApi.get(sessionId, resume.id), format, sessionId)
              } catch (error) {
                state.setError(error instanceof Error ? error.message : 'Export failed. Retry.')
              }
            }}
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
          <div className="grid min-h-0 flex-1 grid-rows-2 @3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @3xl:grid-rows-1">
            <div aria-label="Document preview area" className="min-h-0 overflow-y-auto px-4 py-6">
              <div className="min-h-full bg-document-paper text-document-ink">
                <Preview document={draft} />
              </div>
            </div>
            <div className="flex min-h-0 flex-col border-t border-border @3xl:border-l @3xl:border-t-0">
              <Suspense fallback={<LoadingHint>Opening editor…</LoadingHint>}>
                <EditorPanel
                  document={draft}
                  onChange={change}
                  sectionId={sectionId}
                  onSection={setSectionId}
                  pending={state.pending}
                />
              </Suspense>
            </div>
          </div>
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
