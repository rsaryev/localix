import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { MiniAppCatalogPreviewRecord } from '@localixai/api/client'
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
import { appCount } from '../model/storeFilters'
import type { StoreCatalogs } from '../model/storeActions'

/** What the read catalog says, before the person adds it. */
function PreviewCard({ preview }: { preview: MiniAppCatalogPreviewRecord }) {
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
        {appCount(preview.apps)}
        {from}
      </p>
      <p className="text-xs text-text-soft">
        {preview.added
          ? 'This catalog is already in the store.'
          : 'Its apps are shown as unverified; installing one asks you first.'}
      </p>
    </div>
  )
}

/**
 * Add a catalog by its address: Localix reads it first and says who publishes it and how many
 * apps it holds, and only "Add" keeps it. Opened from the store's catalog menu, from Settings, and
 * by a `localix://` link that fills the address in — nothing is added without that "Add".
 */
export function AddCatalogDialog({
  open,
  initialUrl = '',
  catalogs,
  onOpenChange,
}: {
  open: boolean
  initialUrl?: string
  catalogs: Pick<StoreCatalogs, 'preview' | 'add'>
  onOpenChange: (open: boolean) => void
}) {
  const [draft, setDraft] = useState(initialUrl)
  const [preview, setPreview] = useState<MiniAppCatalogPreviewRecord | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const readFor = useRef<string | null>(null)

  const read = async (url: string) => {
    if (!url.trim() || busy) return
    setBusy(true)
    setProblem(null)
    setPreview(null)
    try {
      setPreview(await catalogs.preview(url.trim()))
    } catch (error) {
      setProblem(errorMessage(error, 'That address is not a mini app catalog'))
    } finally {
      setBusy(false)
    }
  }

  // A link that names a catalog reads it as the dialog opens; adding still waits for "Add".
  useEffect(() => {
    if (!open || !initialUrl || readFor.current === initialUrl) return
    readFor.current = initialUrl
    setDraft(initialUrl)
    void read(initialUrl)
    // `read` is recreated each render; the address is what this follows.
  }, [open, initialUrl])

  const add = async () => {
    if (!preview || busy) return
    setBusy(true)
    try {
      await catalogs.add(preview.url)
      setDraft('')
      setPreview(null)
      onOpenChange(false)
    } catch (error) {
      setProblem(errorMessage(error, 'The catalog could not be added'))
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void (preview && preview.url === draft.trim() ? add() : read(draft))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add a catalog</DialogTitle>
          <DialogDescription>
            Paste the address of a publisher’s mini-app-catalog.json: an HTTPS address, or a file://
            path to a folder on this computer.
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
                placeholder="https://…/mini-app-catalog.json"
                aria-label="Catalog address"
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? 'add-catalog-problem' : undefined}
                className="flex-1"
              />
              <Button
                type="button"
                size="default"
                variant="field"
                disabled={!draft.trim() || busy}
                onClick={() => void read(draft)}
              >
                {busy && !preview ? 'Reading…' : 'Read catalog'}
              </Button>
            </div>
            {problem && (
              <p id="add-catalog-problem" role="alert" className="text-xs text-status-error">
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
                onClick={() => void add()}
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
