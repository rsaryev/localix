import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from 'react'
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
import { SelectionTile } from '@localixai/kit/selection-tile'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { plural, SOURCE_LABELS } from '../model/presentation'

/** What the read source says, before the person adds it. */
function PreviewBody({ preview }: { preview: SourcePreview }) {
  const from = preview.publishers.length ? ` from ${preview.publishers.slice(0, 3).join(', ')}` : ''
  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-semibold text-foreground">
        {SOURCE_LABELS[preview.kind].one}
      </span>
      <span className="text-sm text-foreground">
        {preview.label} · {plural(preview.count, 'package')}
        {from}
      </span>
      {preview.icons.length > 0 && (
        <span className="flex items-center gap-1.5">
          {preview.icons.slice(0, 6).map((icon) => (
            <img key={icon.name} src={icon.src} alt={icon.label} width={28} height={28} />
          ))}
        </span>
      )}
      <span className="text-xs text-text-soft">
        {preview.added
          ? 'It is already in the Store.'
          : preview.verified
            ? 'Localix verifies its publisher.'
            : 'Its packages show as Community; installing one asks you first.'}
      </span>
    </span>
  )
}

/**
 * "Add source…": paste anything — `owner/repo`, a git address, a marketplace.json or
 * mini-app-catalog.json address, a local folder. Every kind that can add a source reads it, and
 * the dialog shows what the ones that understood it found; when both formats match, the person
 * picks. Nothing is added without "Add".
 */
export function AddSourceDialog({
  kinds,
  initial,
  preview: read,
  add,
  onClose,
}: {
  /** The kinds whose provider can add a source. */
  kinds: readonly PackageKind[]
  /** A link that named a source fills the address in and reads it. */
  initial?: { kind?: PackageKind; input: string }
  preview: (kind: PackageKind, input: string) => Promise<SourcePreview>
  add: (kind: PackageKind, input: string) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState(initial?.input ?? '')
  const [found, setFound] = useState<SourcePreview[] | null>(null)
  const [chosen, setChosen] = useState<PackageKind | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const readFor = useRef<string | null>(null)

  const readSource = async (input: string) => {
    if (!input.trim() || busy) return
    setBusy(true)
    setProblem(null)
    setFound(null)
    const asked = initial?.kind && input === initial.input ? [initial.kind] : kinds
    const answers = await Promise.allSettled(asked.map((kind) => read(kind, input.trim())))
    const previews = answers.flatMap((answer) =>
      answer.status === 'fulfilled' ? [answer.value] : [],
    )
    setBusy(false)
    if (previews.length === 0) {
      const reason = answers.find((answer) => answer.status === 'rejected')
      setProblem(
        reason?.status === 'rejected'
          ? errorMessage(reason.reason, 'That address is not a source')
          : 'That address is not a source',
      )
      return
    }
    setFound(previews)
    setChosen(previews[0]!.kind)
  }

  // `readSource` is new each render; the address is what the read follows.
  const readInitial = useEffectEvent((input: string) => readSource(input))
  useEffect(() => {
    if (!initial?.input || readFor.current === initial.input) return
    readFor.current = initial.input
    void readInitial(initial.input)
  }, [initial?.input])

  const picked = found?.find((preview) => preview.kind === chosen)
  const addSource = async () => {
    if (!picked || busy) return
    setBusy(true)
    try {
      await add(picked.kind, picked.id)
      onClose()
    } catch (error) {
      setProblem(errorMessage(error, 'It could not be added'))
      setBusy(false)
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void (picked ? addSource() : readSource(draft))
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add a source</DialogTitle>
          <DialogDescription>
            Paste what a publisher gave you: owner/repo, a git or HTTPS address, a marketplace.json
            or mini-app-catalog.json, or a folder on this computer.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value)
                  setFound(null)
                }}
                placeholder="owner/repo or https://…"
                aria-label="Source address"
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? 'add-source-problem' : undefined}
                className="flex-1"
              />
              <Button
                type="button"
                size="xl"
                variant="field"
                disabled={!draft.trim() || busy}
                onClick={() => void readSource(draft)}
              >
                {busy && !found ? 'Reading…' : 'Read'}
              </Button>
            </div>
            {problem && (
              <p id="add-source-problem" role="alert" className="text-xs text-status-error">
                {problem}
              </p>
            )}
            {found && (
              <div aria-live="polite" className="flex flex-col gap-2">
                {found.length > 1 && (
                  <p className="text-xs text-text-soft">It is both. Which one do you want?</p>
                )}
                {found.map((preview) => (
                  <SelectionTile
                    key={preview.kind}
                    selected={preview.kind === chosen}
                    aria-label={SOURCE_LABELS[preview.kind].one}
                    onClick={() => setChosen(preview.kind)}
                    className="p-3"
                  >
                    <PreviewBody preview={preview} />
                  </SelectionTile>
                ))}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" size="xl" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {picked && !picked.added && (
              <Button type="submit" size="xl" variant="mono" disabled={busy}>
                Add
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
