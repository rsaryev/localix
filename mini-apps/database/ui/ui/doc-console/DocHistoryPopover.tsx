import { useState } from 'react'
import { History, Trash2 } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import {
  Popover,
  PopoverBody,
  PopoverClose,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@localixai/kit/popover'
import type { useSqlHistory } from '../../model/useSqlHistory'

/** History trigger + popover for the doc/kv consoles (recent commands, click to restore).
 *  Hidden entirely while the history is empty — RunBar sets the pattern: a trigger that
 *  can only open an empty panel is a dead toggle, so it appears once it can do something. */
export function DocHistoryPopover({
  history,
  historyLabel,
  triggerTitle = 'Query history',
  onPick,
}: {
  history: ReturnType<typeof useSqlHistory>
  historyLabel: string
  /** Tooltip + accessible name for the trigger (e.g. "Command history" in the kv console). */
  triggerTitle?: string
  onPick: (sql: string) => void
}) {
  const [showHistory, setShowHistory] = useState(false)
  // After the hooks (their count must not vary between renders).
  if (history.entries.length === 0) return null
  return (
    <Popover open={showHistory} onOpenChange={setShowHistory}>
      <PopoverTrigger asChild>
        <IconButton aria-label={triggerTitle} tooltip={triggerTitle} size="xs">
          <History />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        layout="structured"
        align="end"
        side="bottom"
        aria-label={historyLabel}
        className="max-h-60 w-80 max-w-[calc(100vw-1rem)]"
        onOpenAutoFocus={(event) => {
          const content = event.currentTarget
          if (!(content instanceof HTMLElement)) return
          const firstEntry = content.querySelector<HTMLButtonElement>('[data-history-entry]')
          if (!firstEntry) return
          event.preventDefault()
          firstEntry.focus({ preventScroll: true })
        }}
      >
        <PopoverHeader
          actionsLabel="History actions"
          actions={
            <PopoverClose asChild>
              <IconButton
                aria-label="Clear history"
                tooltip="Clear history"
                tone="danger"
                size="xs"
                onClick={history.clear}
              >
                <Trash2 />
              </IconButton>
            </PopoverClose>
          }
        >
          <PopoverTitle>{historyLabel}</PopoverTitle>
        </PopoverHeader>
        <PopoverBody role="list" aria-label={historyLabel} className="p-1">
          {history.entries.map((entry) => (
            <div key={entry.sql} role="listitem">
              <PopoverClose asChild>
                <button
                  data-history-entry
                  type="button"
                  onClick={() => onPick(entry.sql)}
                  className="block w-full truncate rounded-md px-2 py-1 text-left font-mono text-2xs text-text-soft outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:bg-surface-hover focus-ring"
                  title={entry.sql}
                >
                  {entry.sql}
                </button>
              </PopoverClose>
            </div>
          ))}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  )
}
