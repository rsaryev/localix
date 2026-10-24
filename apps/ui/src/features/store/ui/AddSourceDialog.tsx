import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { PackageKind, SourcePreview } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { Input } from '@localixai/kit/input'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { plural, SOURCE_LABELS } from '../model/presentation'

/** What the read source says, before the person adds it. */
function PreviewCard({ preview }: { preview: SourcePreview }) {
  const from = preview.publishers.length ? ` from ${preview.publishers.join(', ')}` : ''
  return (
    <div className="flex flex-col gap-2 rounded-md bg-field-fill p-3" aria-live="polite">
      {preview.icons.length > 0 && (
        <div className="flex items-center gap-2">
          {preview.icons.map((icon) => (
            <img key={icon.name} src={icon.src} alt={icon.label} width={32} height={32} />
          ))}
        </div>
      )}
      <p className="text-sm text-foreground">
        {plural(preview.count, 'package')}
        {from}
      </p>
      <p className="text-xs text-text-soft">
        {preview.added
          ? 'This source is already in the Store.'
          : preview.verified
            ? 'Localix verifies its publisher.'
            : 'Its packages are shown as unverified; installing one asks you first.'}
      </p>
    </div>
  )
}

/**
 * Add a source by its address: the provider reads it first and says who publishes it and how
 * many packages it holds, and only "Add" keeps it. Opened from Sources, a shelf's source menu and
 * a `localix://` link that fills the address in — nothing is added without that "Add".
 */
export function AddSourceDialog({
  kind,
  open,
  initialInput = '',
  preview: read,
  add,
  onOpenChange,
}: {
  kind: PackageKind
  open: boolean
  initialInput?: string
  preview: (kind: PackageKind, input: string) => Promise<SourcePreview>
  add: (kind: PackageKind, input: string) => Promise<void>
  onOpenChange: (open: boolean) => void
}) {
  const [draft, setDraft] = useState(initialInput)
  const [preview, setPreview] = useState<SourcePreview | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const readFor = useRef<string | null>(null)
  const noun = SOURCE_LABELS[kind].one

  const readSource = async (input: string) => {
    if (!input.trim() || busy) return
    setBusy(true)
    setProblem(null)
    setPreview(null)
    try {
      setPreview(await read(kind, input.trim()))
    } catch (error) {
      setProblem(errorMessage(error, `That address is not a ${noun}`))
    } finally {
      setBusy(false)
    }
  }

  // A link that names a source reads it as the dialog opens; adding still waits for "Add".
  useEffect(() => {
    if (!open || !initialInput || readFor.current === initialInput) return
    readFor.current = initialInput
    setDraft(initialInput)
    void readSource(initialInput)
    // `readSource` is recreated each render; the address is what this follows.
  }, [open, initialInput])

  const addSource = async () => {
    if (!preview || busy) return
    setBusy(true)
    try {
      await add(kind, preview.id)
      setDraft('')
      setPreview(null)
      onOpenChange(false)
    } catch (error) {
      setProblem(errorMessage(error, 'It could not be added'))
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void (preview && preview.id === draft.trim() ? addSource() : readSource(draft))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add a {noun}</DialogTitle>
          <DialogDescription>
            Paste the address a publisher gave you: an HTTPS address, or a file:// path to a folder
            on this computer.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value)
                  setPreview(null)
                }}
                placeholder="https://…"
                aria-label="Source address"
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? 'add-source-problem' : undefined}
                className="flex-1"
              />
              <Button
                type="button"
                size="default"
                variant="field"
                disabled={!draft.trim() || busy}
                onClick={() => void readSource(draft)}
              >
                {busy && !preview ? 'Reading…' : 'Read'}
              </Button>
            </div>
            {problem && (
              <p id="add-source-problem" role="alert" className="text-xs text-status-error">
                {problem}
              </p>
            )}
            {preview && <PreviewCard preview={preview} />}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              size="default"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            {preview && !preview.added && (
              <Button
                type="button"
                size="default"
                variant="mono"
                disabled={busy}
                onClick={() => void addSource()}
              >
                Add
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
