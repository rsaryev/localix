import { useState } from 'react'
import { Copy, FileText, Inbox, Plus, Search, Pencil, Trash2, Download } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { SearchInput } from '@localixai/kit/search-input'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import { ResumeRow } from './ResumeRow'
import { LibraryDialog } from './LibraryDialog'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import type { downloadResume } from './export'
import type { ResumeSummary } from '../shared/schema'

export function ResumeLibrary({
  resumes,
  pending,
  onCreate,
  onBrowse,
  onOpen,
  onRename,
  onDelete,
  onDuplicate,
  onExport,
}: {
  resumes: ResumeSummary[]
  pending: boolean
  onCreate: () => void
  onBrowse: () => void
  onOpen: (resume: ResumeSummary) => void
  onRename: (resume: ResumeSummary, title: string) => Promise<boolean>
  onDelete: (resume: ResumeSummary) => Promise<boolean>
  onDuplicate: (resume: ResumeSummary) => Promise<boolean>
  onExport: (resume: ResumeSummary, format: Parameters<typeof downloadResume>[1]) => void
}) {
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<{
    action: 'rename' | 'delete'
    resume: ResumeSummary
  } | null>(null)
  const entries = (resume: ResumeSummary): MenuEntry[] => [
    {
      id: 'open',
      label: 'Open resume',
      icon: FileText,
      disabled: pending,
      onSelect: () => onOpen(resume),
    },
    {
      id: 'rename',
      label: 'Rename',
      icon: Pencil,
      disabled: pending,
      onSelect: () => setDialog({ action: 'rename', resume }),
    },
    {
      id: 'duplicate',
      label: 'Create a copy',
      icon: Copy,
      disabled: pending,
      onSelect: () => {
        void onDuplicate(resume)
      },
    },
    {
      id: 'export',
      label: 'Export',
      icon: Download,
      disabled: pending,
      items: (['pdf', 'docx', 'markdown', 'text', 'json', 'yaml', 'lanjut'] as const).map(
        (format) => ({
          id: format,
          label: {
            pdf: 'PDF',
            docx: 'Word',
            markdown: 'Markdown',
            text: 'Plain text',
            json: 'Resume JSON',
            yaml: 'Resume YAML',
            lanjut: 'Lanjut JSON',
          }[format],
          onSelect: () => onExport(resume, format),
        }),
      ),
    },
    { separator: true },
    {
      id: 'delete',
      label: 'Delete resume…',
      icon: Trash2,
      danger: true,
      disabled: pending,
      onSelect: () => setDialog({ action: 'delete', resume }),
    },
  ]
  const filtered = resumes.filter((resume) =>
    `${resume.title} ${resume.targetRole}`.toLowerCase().includes(query.trim().toLowerCase()),
  )
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkbenchToolbar aria-label="Resume library actions">
        <WorkbenchToolbarSection className="min-w-0 flex-1">
          <SearchInput
            aria-label="Search resumes"
            placeholder="Search your resumes"
            size="md"
            value={query}
            onValueChange={setQuery}
            className="w-full min-w-0 max-w-64"
          />
        </WorkbenchToolbarSection>
        <WorkbenchToolbarSection align="end">
          <Button variant="ghost" size="sm" disabled={pending} onClick={onCreate}>
            <Plus data-icon="inline-start" />
            New resume
          </Button>
        </WorkbenchToolbarSection>
      </WorkbenchToolbar>
      {resumes.length === 0 ? (
        <StateNotice
          icon={Inbox}
          title="No resumes yet"
          body="Start from a template, or create a blank resume."
          actionsLabel="Create your first resume"
          actions={
            <>
              <Button variant="field" onClick={onBrowse}>
                <Search data-icon="inline-start" />
                Browse templates
              </Button>
              <Button variant="ghost" onClick={onCreate}>
                <FileText data-icon="inline-start" />
                New resume
              </Button>
            </>
          }
        />
      ) : (
        <div
          aria-label="Saved resumes"
          role="region"
          className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
        >
          {filtered.length === 0 && <EmptyHint>No resumes match “{query}”.</EmptyHint>}
          {filtered.map((resume) => (
            <ResumeRow
              key={resume.id}
              resume={resume}
              onOpen={() => onOpen(resume)}
              entries={entries(resume)}
              disabled={pending}
            />
          ))}
        </div>
      )}
      {dialog && (
        <LibraryDialog
          key={dialog.resume.id + dialog.action}
          {...dialog}
          pending={pending}
          onClose={() => setDialog(null)}
          onConfirm={(title) =>
            dialog.action === 'rename' ? onRename(dialog.resume, title) : onDelete(dialog.resume)
          }
        />
      )}
    </div>
  )
}
