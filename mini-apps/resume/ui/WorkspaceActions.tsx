import { ArrowLeft, Plus, Save, Undo2, Redo2, Eye, Ellipsis } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { Button } from '@localixai/kit/button'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import type { useResumes } from './useResumes'
import type { downloadResume } from './export'
import { ChoiceMenu } from './ChoiceMenu'

export function WorkspaceActions({
  state,
  setConfirm,
  exporting,
  preview,
  previewId,
  onTogglePreview,
  exportFile,
  onHistory,
  onNew,
  onImport,
  onLibrary,
}: {
  state: ReturnType<typeof useResumes>
  setConfirm: (confirm: 'discard' | 'delete' | null) => void
  exporting: boolean
  preview: boolean
  previewId: string
  onTogglePreview: () => void
  onHistory: () => void
  onNew: () => void
  onImport: () => void
  onLibrary: () => void
  exportFile: (format: Parameters<typeof downloadResume>[1]) => Promise<void>
}) {
  const { base, draft } = state
  return (
    <WorkbenchToolbar aria-label="Resume actions">
      <WorkbenchToolbarSection className="flex-1">
        <IconButton size="sm" aria-label="Back to resumes" onClick={onLibrary}>
          <ArrowLeft />
        </IconButton>
        <ChoiceMenu
          label={draft?.title || 'Resumes'}
          className="min-w-0 flex-1 justify-start max-w-48 @xl:max-w-72"
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
        <Button
          variant="ghost"
          size="sm"
          className="hidden @3xl:inline-flex"
          disabled={state.pending || state.dirty}
          onClick={onNew}
        >
          <Plus data-icon="inline-start" />
          New resume
        </Button>
        <ChoiceMenu
          label="More"
          icon={<Ellipsis />}
          disabled={state.pending}
          entries={[
            {
              id: 'undo',
              label: 'Undo',
              disabled: state.pending || !state.canUndo,
              onSelect: state.undo,
            },
            {
              id: 'redo',
              label: 'Redo',
              disabled: state.pending || !state.canRedo,
              onSelect: state.redo,
            },
            {
              id: 'discard',
              label: 'Discard draft…',
              disabled: !state.dirty,
              onSelect: () => setConfirm('discard'),
            },
            {
              id: 'new',
              label: 'New resume',
              disabled: state.dirty,
              onSelect: onNew,
            },
            {
              id: 'import',
              label: 'Import resume…',
              disabled: state.dirty,
              onSelect: onImport,
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
        <WorkbenchToolbarSection align="end" spacing="compact">
          <IconButton
            aria-label={state.pending ? 'Saving resume' : 'Save resume'}
            tooltip={state.pending ? 'Saving resume' : 'Save resume'}
            size="sm"
            disabled={!state.dirty || state.pending}
            onClick={() => void state.save()}
          >
            <Save />
          </IconButton>
          <IconButton
            aria-label="PDF preview"
            aria-pressed={preview}
            aria-controls={previewId}
            tooltip={preview ? 'Hide PDF preview' : 'Show PDF preview'}
            size="sm"
            onClick={onTogglePreview}
          >
            <Eye />
          </IconButton>
          <IconButton
            aria-label="Undo"
            tooltip="Undo"
            className="hidden @xl:inline-flex"
            size="sm"
            disabled={state.pending || !state.canUndo}
            onClick={state.undo}
          >
            <Undo2 />
          </IconButton>
          <IconButton
            aria-label="Redo"
            tooltip="Redo"
            className="hidden @xl:inline-flex"
            size="sm"
            disabled={state.pending || !state.canRedo}
            onClick={state.redo}
          >
            <Redo2 />
          </IconButton>
          <ChoiceMenu
            label="Export"
            disabled={state.pending || state.dirty || exporting}
            entries={(['pdf', 'docx', 'markdown', 'text', 'json', 'yaml', 'lanjut'] as const).map(
              (format) => ({
                id: format,
                label: {
                  pdf: 'PDF',
                  docx: 'Word',
                  markdown: 'Markdown',
                  text: 'Plain text',
                  json: 'Portable JSON',
                  yaml: 'Portable YAML',
                  lanjut: 'Lanjut JSON',
                }[format],
                description:
                  format === 'pdf' || format === 'docx'
                    ? format === 'pdf'
                      ? 'Matches the A4 preview.'
                      : 'Template typography in an editable linear document.'
                    : undefined,
                onSelect: () => {
                  void exportFile(format)
                },
              }),
            )}
          />
        </WorkbenchToolbarSection>
      )}
    </WorkbenchToolbar>
  )
}
