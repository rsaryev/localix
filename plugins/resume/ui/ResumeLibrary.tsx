import { useState } from 'react'
import { Copy, FileText, Inbox, Plus, Search, Pencil, Trash2, Download } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { SearchInput } from '@localixai/kit/search-input'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'
import { SelectionTile } from '@localixai/kit/selection-tile'
import { ResumeCard } from './ResumeCard'
import { LibraryDialog } from './LibraryDialog'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import type { downloadResume } from './export'
import type { ResumeSummary } from '../shared/schema'

export function ResumeLibrary({
  resumes,
  pending,
  onCreate,
  onBrowse,
  onOpen,
  sessionId,
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
  sessionId: string
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
      items: (['pdf', 'docx', 'markdown', 'text', 'json'] as const).map((format) => ({
        id: format,
        label: {
          pdf: 'PDF',
          docx: 'Word',
          markdown: 'Markdown',
          text: 'Plain text',
          json: 'Resume JSON',
        }[format],
        onSelect: () => onExport(resume, format),
      })),
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
    `${resume.title} ${resume.targetRole}`.toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-5 @2xl:px-6">
      <div className="flex items-center justify-between gap-3">
        <SearchInput
          aria-label="Search resumes"
          placeholder="Search your resumes"
          value={query}
          onValueChange={setQuery}
          className="w-64 max-w-full"
        />
        <Button variant="field" disabled={pending} onClick={onCreate}>
          <Plus data-icon="inline-start" />
          Resume
        </Button>
      </div>
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
        <div className="mt-5 grid min-h-0 grid-cols-[repeat(auto-fill,minmax(min(100%,240px),280px))] items-start gap-4 overflow-y-auto">
          {filtered.length === 0 && <EmptyHint>No resumes match “{query}”.</EmptyHint>}
          {filtered.map((resume) => (
            <ResumeCard
              key={resume.id}
              resume={resume}
              sessionId={sessionId}
              onOpen={() => onOpen(resume)}
              entries={entries(resume)}
              disabled={pending}
            />
          ))}
          {!query && (
            <SelectionTile
              aria-pressed={undefined}
              aria-label="Create a new resume"
              onClick={onCreate}
              disabled={pending}
              className="min-h-64 items-center justify-center gap-3 border-dashed"
            >
              <Plus className="size-5 text-text-faint" />
              <span>New resume</span>
            </SelectionTile>
          )}
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
