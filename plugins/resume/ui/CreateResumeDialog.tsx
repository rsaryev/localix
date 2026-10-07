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
import { SegmentedRadioGroup } from '@localixai/plugin-sdk/ui/segmented-control'
import { documentSchema, type ResumeDocument } from '../shared/schema'
import { createTemplateDocument, type TemplateId } from '../shared/templates'
import { createSampleDocument } from '../shared/sample'
import { TemplateGallery } from './TemplateGallery'

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
  const submit = async () => {
    if (!title.trim()) {
      setError('Enter a name for this resume.')
      return
    }
    if (source === 'import' && !imported) {
      setError('Choose a structured resume JSON file.')
      return
    }
    const document =
      source === 'import'
        ? { ...imported!, title: title.trim(), presentation: { template } }
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
              autoFocus
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
              description="Import portable resume JSON. Share PDF, Word or other source files with the agent to convert them."
            >
              <Input
                type="file"
                accept=".json,application/json"
                disabled={pending}
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  try {
                    if (file.size > 400_000) throw new Error('Resume file exceeds 400 KB.')
                    const document = documentSchema.parse(JSON.parse(await file.text()))
                    setImported(document)
                    setTemplate(document.presentation.template)
                    if (!title.trim()) setTitle(document.title)
                    setError(null)
                  } catch {
                    setImported(null)
                    setError(
                      'This file is not valid resume JSON. Choose a portable resume export, or ask the agent to convert your source file.',
                    )
                  }
                }}
              />
            </Field>
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
            disabled={pending || !title.trim() || (source === 'import' && !imported)}
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
