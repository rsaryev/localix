import { useState } from 'react'
import { Clock3, Trash2, X } from 'lucide-react'
import { clockTime } from '@/shared/lib/calendarDay'
import { SearchInput } from '@localixai/kit/search-input'
import { StateNotice } from '@localixai/kit/state-notice'
import { IconButton } from '@localixai/kit/icon-button'
import { Button } from '@localixai/kit/button'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { WorkbenchListRowActions, WorkbenchListRowMeta } from '@localixai/kit/workbench-list-row'
import { historyDays, useBrowserHistory, visitName } from '../model/browserHistory'
import { BrowserVisitRow } from './BrowserVisitRow'

/**
 * Every page visited, newest first, under the day it was visited on — so each row carries only
 * its clock. Searchable, and each page removable on its own.
 */
export function BrowserHistoryTab({ onOpen }: { onOpen: (url: string) => void }) {
  const [query, setQuery] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const visits = useBrowserHistory((state) => state.visits)
  const remove = useBrowserHistory((state) => state.remove)
  const clear = useBrowserHistory((state) => state.clear)
  const needle = query.trim().toLowerCase()
  const results = needle
    ? visits.filter(
        (visit) =>
          visit.url.toLowerCase().includes(needle) || visit.title?.toLowerCase().includes(needle),
      )
    : visits

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkbenchToolbar density="compact" aria-label="History controls">
        <SearchInput
          aria-label="Search browser history"
          placeholder="Search pages and addresses"
          value={query}
          onValueChange={setQuery}
          size="md"
          className="min-w-0 flex-1"
        />
        {visits.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirmClear(true)}
            className="shrink-0 text-text-soft"
          >
            <Trash2 className="size-3.5" />
            Clear history
          </Button>
        )}
      </WorkbenchToolbar>
      {results.length === 0 ? (
        <StateNotice
          className="flex-1"
          icon={Clock3}
          title={needle ? 'No matching pages' : 'No history yet'}
          body={needle ? 'Try another search.' : 'Pages you visit will appear here.'}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {historyDays(results).map((day) => (
            <section key={day.start} className="pb-3 last:pb-0">
              <h2 className="px-1 pb-1 text-2xs font-medium uppercase tracking-wide text-text-faint">
                <time dateTime={new Date(day.start).toISOString()}>{day.label}</time>
              </h2>
              <ul className="flex flex-col gap-px">
                {day.visits.map((visit) => {
                  const { title } = visitName(visit)
                  const at = new Date(visit.visitedAt)
                  return (
                    <li key={visit.url}>
                      <BrowserVisitRow visit={visit} onOpen={onOpen}>
                        <WorkbenchListRowMeta className="tabular-nums">
                          <time dateTime={at.toISOString()}>{clockTime(at)}</time>
                        </WorkbenchListRowMeta>
                        <WorkbenchListRowActions aria-label={`${title} actions`} visibility="hover">
                          <IconButton
                            size="sm"
                            aria-label={`Remove ${title} from history`}
                            tooltip="Remove from history"
                            onClick={() => remove([visit.url])}
                          >
                            <X className="size-3.5" />
                          </IconButton>
                        </WorkbenchListRowActions>
                      </BrowserVisitRow>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={confirmClear}
        title="Clear browser history?"
        description={`Remove all ${visits.length} visited pages from this app? Open tabs will stay open.`}
        confirmLabel="Clear history"
        onConfirm={clear}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  )
}
