import { useState } from 'react'
import { Plus } from 'lucide-react'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { Button } from '@localixai/kit/button'
import { Checkbox } from '@localixai/kit/checkbox'
import { Textarea } from '@localixai/kit/textarea'
import { SegmentedRadioGroup } from '@localixai/mini-app-sdk/ui/segmented-control'
import { emptyEntry, type ResumeDocument } from '../shared/schema'
import { importResumeFile } from './importFile'
import { markdownBody } from '../shared/markdown'
import { createTemplateDocument, type TemplateId } from '../shared/templates'
import { createSampleDocument } from '../shared/sample'
import { TemplateGallery } from './TemplateGallery'
import { focusOnMount } from './focusOnMount'

type Source = 'sample' | 'blank' | 'import'
export function CreateResumeDialog({
  open,
  onClose,
  initialSource = 'blank',
  pending,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  initialSource?: Source
  pending: boolean
  onCreate: (document: ResumeDocument) => Promise<boolean>
}) {
  const [title, setTitle] = useState('')
  const [source, setSource] = useState<Source>(initialSource)
  const [template, setTemplate] = useState<TemplateId>('awal')
  const [imported, setImported] = useState<ResumeDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [leftovers, setLeftovers] = useState('')
  const [includeLeftovers, setIncludeLeftovers] = useState(true)
  const [sourceReview, setSourceReview] = useState(false)
  const readFile = async (file: File) => {
    setReading(true)
    try {
      const result = await importResumeFile(file)
      setImported(result.document)
      setLeftovers(result.leftovers)
      setSourceReview(result.source)
      setTemplate(result.document.presentation.template)
      if (!title.trim()) setTitle(result.document.title)
      setError(null)
    } catch (failure) {
      setImported(null)
      setError(failure instanceof Error ? failure.message : 'Could not import this file.')
    } finally {
      setReading(false)
    }
  }
  const submit = async () => {
    if (!title.trim()) {
      setError('Enter a name for this resume.')
      return
    }
    if (source === 'import' && !imported) {
      setError('Choose a resume file to import.')
      return
    }
    const document =
      source === 'import'
        ? {
            ...imported!,
            title: title.trim(),
            presentation: { ...imported!.presentation, template },
            sections: [
              ...imported!.sections,
              ...(includeLeftovers && leftovers.trim()
                ? [
                    {
                      id: crypto.randomUUID(),
                      type: 'custom' as const,
                      variant: 'rich' as const,
                      title: 'Imported notes',
                      hidden: false,
                      entries: [{ ...emptyEntry(), body: markdownBody(leftovers) }],
                    },
                  ]
                : []),
            ],
          }
        : source === 'sample'
          ? createSampleDocument(template, title.trim())
          : createTemplateDocument(template, title.trim())
    if (await onCreate(document)) onClose()
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose()
      }}
    >
      <DialogContent
        size="3xl"
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>Create a new resume</DialogTitle>
          <DialogDescription>
            Name it, choose where to start, and pick a template.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="@container space-y-5">
          <Field label="Resume name" required error={!title.trim() && error ? error : undefined}>
            <Input
              ref={focusOnMount}
              value={title}
              maxLength={500}
              placeholder="Software Engineer"
              disabled={pending}
              onChange={(event) => {
                setTitle(event.target.value)
                setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
          </Field>
          <Field label="Start from">
            <SegmentedRadioGroup
              aria-label="Start from"
              value={source}
              onValueChange={(value) => {
                setSource(value)
                setError(null)
              }}
              disabled={pending}
              options={[
                { value: 'sample', label: 'Sample' },
                { value: 'blank', label: 'Blank' },
                { value: 'import', label: 'Import a file' },
              ]}
            />
          </Field>
          {source === 'sample' && (
            <p className="text-xs text-text-soft">
              Sample content is illustrative. Replace it with your own information before sharing.
            </p>
          )}
          {source === 'import' && (
            <Field
              label="Resume file"
              description="Localix or Lanjut JSON/YAML, PDF, Word, ODT, Markdown or plain text. Review extracted content before creating the resume."
            >
              <Input
                type="file"
                accept=".json,.yaml,.yml,.pdf,.docx,.doc,.odt,.md,.txt"
                disabled={pending || reading}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void readFile(file)
                }}
              />
            </Field>
          )}
          {reading && (
            <p role="status" className="text-xs text-text-soft">
              Reading resume…
            </p>
          )}
          {source === 'import' && imported && (
            <section aria-label="Import review" className="space-y-3">
              <h2 className="text-sm font-medium">Review imported content</h2>
              <p className="text-xs text-text-soft">
                {imported.header.name || 'No name recognized'} · {imported.sections.length}{' '}
                sections.{' '}
                {sourceReview
                  ? 'Section text is preserved; review roles, companies and dates in the editor after creation.'
                  : 'Structured fields and presentation imported.'}
              </p>
              {leftovers && (
                <>
                  <Field
                    label="Unassigned source text"
                    description="Keep this as an editable custom section, or clear the checkbox to exclude it."
                  >
                    <Textarea
                      value={leftovers}
                      rows={5}
                      maxLength={8_000}
                      onChange={(event) => setLeftovers(event.target.value)}
                    />
                  </Field>
                  <Field label="Include unassigned text as Imported notes" layout="inline">
                    <Checkbox
                      checked={includeLeftovers}
                      onChange={(event) => setIncludeLeftovers(event.target.checked)}
                    />
                  </Field>
                </>
              )}
            </section>
          )}
          <Field label="Template">
            <TemplateGallery value={template} onChange={setTemplate} disabled={pending} />
          </Field>
          {error && title.trim() && (
            <p role="alert" className="text-xs text-status-error">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="field"
            recommended
            disabled={pending || reading || !title.trim() || (source === 'import' && !imported)}
            onClick={() => void submit()}
          >
            <Plus data-icon="inline-start" />
            {pending ? 'Creating…' : 'Create resume'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
