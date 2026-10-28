import { NotebookPen, Trash2 } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { SectionLabel } from '@localixai/kit/section-label'
import { StateNotice } from '@localixai/kit/state-notice'
import type { Entry } from '../../shared/model'

/** Today's entries, newest first. Empty, it says how to log one from the chat. */
export function EntryList({
  entries,
  unit,
  disabled,
  onRemove,
}: {
  entries: Entry[]
  unit: string
  disabled: boolean
  onRemove: (id: string) => void
}) {
  if (!entries.length) {
    return (
      <StateNotice
        icon={NotebookPen}
        title="Nothing logged today"
        body="Tell the agent what happened in the chat — or attach a photo — and it lands here."
      />
    )
  }
  return (
    <section aria-label="Today's entries" className="flex flex-col gap-2">
      <SectionLabel size="2xs">Today</SectionLabel>
      <ul className="divide-y divide-border-faint overflow-hidden rounded-lg border border-border">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{entry.title}</p>
              <p className="mt-0.5 truncate text-xs text-text-faint">
                {new Date(entry.at).toLocaleTimeString(undefined, { timeStyle: 'short' })} ·{' '}
                {entry.category}
                {entry.note && ` · ${entry.note}`}
              </p>
            </div>
            <span className="text-sm font-medium tabular-nums text-foreground">
              {entry.amount} <span className="text-xs text-text-faint">{unit}</span>
            </span>
            <IconButton
              aria-label={`Remove ${entry.title}`}
              tooltip="Remove"
              size="sm"
              tone="danger"
              disabled={disabled}
              onClick={() => onRemove(entry.id)}
            >
              <Trash2 />
            </IconButton>
          </li>
        ))}
      </ul>
    </section>
  )
}
