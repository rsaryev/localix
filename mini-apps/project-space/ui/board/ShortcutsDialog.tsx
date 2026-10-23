import { keyboardHelp } from '@localixai/kit/canvas'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { Kbd } from '@localixai/kit/kbd'
import { formatChordText } from '@localixai/kit/keybindings'
import { boardShortcuts, presentingShortcuts, writingShortcuts } from './shortcuts'

/**
 * `?` — every key the board answers, grouped by what it is for (`shortcuts.ts` is the list). The
 * camera's own keys are the host canvas's and are said in its own words, so the sheet cannot
 * describe a camera that another board no longer has.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle>Board shortcuts</DialogTitle>
          <DialogDescription>{keyboardHelp('edit')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid items-start gap-6 sm:grid-cols-2">
          {[...boardShortcuts(), writingShortcuts(), presentingShortcuts()].map((group) => (
            <section
              key={group.title}
              aria-label={group.title}
              className={`min-w-0 ${group.title === 'Camera' ? 'sm:col-span-2' : ''}`}
            >
              <h3 className="mb-2 text-3xs font-medium uppercase tracking-wide text-text-faint">
                {group.title}
              </h3>
              {/* Content-sized key columns moved every section's labels to a different edge.
                  One key rail keeps them aligned; alternative chords wrap inside it. */}
              <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 text-2xs leading-5">
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.does} className="contents">
                    <dt className="flex min-h-5 min-w-0 flex-wrap items-center justify-end gap-1">
                      {shortcut.keys.map((chord) => (
                        <Kbd
                          key={chord}
                          variant="filled"
                          className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center whitespace-nowrap"
                        >
                          {formatChordText(chord)}
                        </Kbd>
                      ))}
                    </dt>
                    <dd className="min-w-0 wrap-anywhere text-text-soft">{shortcut.does}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
