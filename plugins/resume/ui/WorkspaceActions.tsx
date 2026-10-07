import { ArrowLeft, Plus, Save, Undo2, Redo2 } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { Button } from '@localixai/kit/button'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import type { useResumes } from './useResumes'
import type { downloadResume } from './export'
import { ChoiceMenu } from './ChoiceMenu'

export function WorkspaceActions({
  state,
  setConfirm,
  importing,
  setImporting,
  exporting,
  exportFile,
  onHistory,
  onNew,
  onLibrary,
}: {
  state: ReturnType<typeof useResumes>
  setConfirm: (confirm: 'discard' | 'delete' | null) => void
  importing: boolean
  setImporting: (value: boolean) => void
  exporting: boolean
  onHistory: () => void
  onNew: () => void
  onLibrary: () => void
  exportFile: (format: Parameters<typeof downloadResume>[1]) => Promise<void>
}) {
  const { base, draft } = state
  return (
    <WorkbenchToolbar aria-label="Resume actions" wrap>
      <WorkbenchToolbarSection wrap>
        <IconButton size="sm" aria-label="Back to resumes" onClick={onLibrary}>
          <ArrowLeft />
        </IconButton>
        <ChoiceMenu
          label={draft?.title || 'Resumes'}
          disabled={state.pending}
          entries={state.resumes.map((resume) => ({
            id: resume.id,
            label: resume.title,
            selected: base?.id === resume.id,
            onSelect: () => {
              state.select(resume)
              setConfirm(null)
            },
          }))}
        />
        <Button variant="ghost" size="sm" disabled={state.pending || state.dirty} onClick={onNew}>
          <Plus data-icon="inline-start" />
          New resume
        </Button>
        <ChoiceMenu
          label="More"
          disabled={state.pending}
          entries={[
            {
              id: 'import',
              label: 'Import resume JSON',
              disabled: state.dirty,
              onSelect: () => setImporting(!importing),
            },
            {
              id: 'duplicate',
              label: 'Create variant',
              disabled: !base || state.dirty,
              onSelect: state.duplicate,
            },
            {
              id: 'draft-variant',
              label: 'Save draft as variant',
              disabled: !state.dirty,
              onSelect: state.saveVariant,
            },
            {
              id: 'reload',
              label: 'Refresh saved state',
              onSelect: () => {
                void state.refresh()
              },
            },
            {
              id: 'history',
              label: 'Saved history',
              disabled: !base,
              onSelect: onHistory,
            },
            {
              id: 'delete',
              label: 'Delete resume…',
              disabled: !base || state.dirty,
              onSelect: () => setConfirm('delete'),
            },
          ]}
        />
      </WorkbenchToolbarSection>
      {base && draft && (
        <WorkbenchToolbarSection align="end" wrap>
          <IconButton
            aria-label={state.pending ? 'Saving resume' : 'Save resume'}
            size="sm"
            disabled={!state.dirty || state.pending}
            onClick={state.save}
          >
            <Save />
          </IconButton>
          <IconButton
            aria-label="Undo"
            size="sm"
            disabled={state.pending || !state.canUndo}
            onClick={state.undo}
          >
            <Undo2 />
          </IconButton>
          <IconButton
            aria-label="Redo"
            size="sm"
            disabled={state.pending || !state.canRedo}
            onClick={state.redo}
          >
            <Redo2 />
          </IconButton>
          {state.dirty && (
            <Button
              variant="ghost"
              size="sm"
              disabled={state.pending}
              onClick={() => setConfirm('discard')}
            >
              Discard…
            </Button>
          )}
          <ChoiceMenu
            label="Export"
            disabled={state.pending || state.dirty || exporting}
            entries={(['pdf', 'docx', 'markdown', 'text', 'json'] as const).map((format) => ({
              id: format,
              label: {
                pdf: 'PDF via Documents',
                docx: 'Word via Documents',
                markdown: 'Markdown',
                text: 'Plain text',
                json: 'Portable JSON',
              }[format],
              description:
                format === 'pdf' || format === 'docx'
                  ? 'Linear document with Documents typography.'
                  : undefined,
              onSelect: () => {
                void exportFile(format)
              },
            }))}
          />
        </WorkbenchToolbarSection>
      )}
    </WorkbenchToolbar>
  )
}
