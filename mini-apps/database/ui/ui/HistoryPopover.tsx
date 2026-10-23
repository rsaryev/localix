import { useState } from 'react'
import { Trash2, Star } from 'lucide-react'
import { ActionFeedback, useActionFeedback } from '@localixai/kit/action-feedback'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { formatRelativeTime } from '@localixai/plugin-sdk/ui/utilities'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import {
  PopoverBody,
  PopoverClose,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
} from '@localixai/kit/popover'
import { SearchInput } from '@localixai/kit/search-input'
import type { SqlHistoryState } from '../model/useSqlHistory'
import { sortHistory } from '../model/sqlHistory'

/** Query-history dropdown for the console run bar: filterable, pin-to-top, clear-all
 *  (keeps pinned). Picking an entry loads it into the editor. */
export function HistoryPopover({
  history,
  onPick,
}: {
  history: SqlHistoryState
  onPick: (sql: string) => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const rows = sortHistory(history.entries).filter((e) => !q || e.sql.toLowerCase().includes(q))
  // Unpinned entries are what a clear actually removes.
  const clearable = history.entries.filter((entry) => !entry.pinned).length

  // One click used to destroy up to SQL_HISTORY_CAP statements permanently — persisted to
  // localStorage, no confirmation, no undo. A confirm dialog would tax every clear; an undo
  // costs nothing on the happy path and fully recovers a misclick, which is the pattern this
  // codebase already uses for a destructive file action (see useFileTree's delete toast).
  //
  // The answer stands beside the Clear button it answers, not in the journal: a cleared history
  // is the person's own action, and as a durable row it raised the bell's count for a click. The
  // undo still names the clear it belongs to: a later clear or a connection switch makes it
  // stale, and a stale click says so instead of resurrecting statements removed again.
  const feedback = useActionFeedback()
  const clearWithUndo = () => {
    const snapshot = history.entries
    if (clearable === 0) return
    const revision = history.clear()
    feedback.show(`Cleared ${clearable} ${clearable === 1 ? 'query' : 'queries'}`, {
      tone: 'success',
      action: {
        label: 'Undo',
        onClick: () => {
          if (history.restore(snapshot, revision)) return
          feedback.show('Nothing to undo: the history changed since', { tone: 'warning' })
        },
      },
    })
  }

  return (
    <PopoverContent
      layout="structured"
      align="end"
      side="bottom"
      aria-label="Query history"
      className="max-h-80 w-96 max-w-[calc(100vw-1rem)]"
      onOpenAutoFocus={(event) => {
        const content = event.currentTarget
        if (!(content instanceof HTMLElement)) return
        const search = content.querySelector<HTMLInputElement>('[data-history-search]')
        if (!search) return
        event.preventDefault()
        search.focus({ preventScroll: true })
      }}
    >
      <PopoverHeader
        actionsLabel="Query history actions"
        actions={
          <>
            <ActionFeedback store={feedback} />
            <Button
              variant="ghost"
              size="xs"
              onClick={clearWithUndo}
              disabled={clearable === 0}
              title={
                clearable === 0
                  ? 'Nothing to clear — pinned queries are kept'
                  : 'Clear history (keeps pinned)'
              }
              className="text-text-faint hover:text-status-error"
            >
              <Trash2 data-icon="inline-start" aria-hidden className="size-3" />
              Clear
            </Button>
          </>
        }
      >
        <PopoverTitle>Query history</PopoverTitle>
        <SearchInput
          data-history-search
          value={query}
          onValueChange={setQuery}
          placeholder="Filter query history…"
          size="md"
        />
      </PopoverHeader>
      <PopoverBody role="list" aria-label="Saved queries" className="p-0">
        {rows.length === 0 ? (
          <div className="px-2 py-3 text-center text-2xs text-text-faint">
            {history.entries.length === 0 ? 'No queries yet' : 'No matches'}
          </div>
        ) : (
          rows.map((entry) => (
            <div
              key={entry.sql}
              role="listitem"
              className="flex items-center gap-1 border-b border-border-soft pr-1 transition-colors last:border-b-0 hover:bg-surface-hover"
            >
              <PopoverClose asChild>
                <button
                  type="button"
                  onClick={() => onPick(entry.sql)}
                  className="min-w-0 flex-1 px-2 py-1.5 text-left outline-none focus-ring"
                >
                  <pre className="truncate font-mono text-2xs text-text-soft">
                    {entry.sql.replace(/\s+/g, ' ')}
                  </pre>
                </button>
              </PopoverClose>
              <span
                className="shrink-0 pr-0.5 text-2xs tabular-nums text-text-faint"
                title={new Date(entry.at).toLocaleString()}
              >
                {formatRelativeTime(entry.at)}
              </span>
              <IconButton
                size="xs"
                onClick={() => history.togglePin(entry.sql)}
                aria-label={entry.pinned ? 'Unpin' : 'Pin to top'}
                tooltip={entry.pinned ? 'Unpin' : 'Pin to top'}
                aria-pressed={entry.pinned}
                className={cn(
                  'shrink-0',
                  entry.pinned ? 'text-status-warning' : 'text-text-faint hover:text-foreground',
                )}
              >
                <Star className={cn('size-3', entry.pinned && 'fill-current')} />
              </IconButton>
            </div>
          ))
        )}
      </PopoverBody>
    </PopoverContent>
  )
}
