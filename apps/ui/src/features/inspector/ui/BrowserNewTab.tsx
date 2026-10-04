import { useId } from 'react'
import { Globe2 } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { StateNotice } from '@localixai/kit/state-notice'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { useBrowserHistory } from '../model/browserHistory'
import { BrowserVisitRow } from './BrowserVisitRow'
import { PreviewAddressBar } from './PreviewAddressBar'

/** Enough to pick up where one left off; the full list is the History tab. */
const RECENT_PAGES = 8

/**
 * A tab with no page yet: the address field, already focused, over the pages visited most
 * recently — so opening a tab is one keystroke to a new page, or one click back to a known one.
 */
export function BrowserNewTab({
  onOpen,
  onOpenHistory,
}: {
  onOpen: (url: string) => void
  onOpenHistory: () => void
}) {
  const headingId = useId()
  const visits = useBrowserHistory((state) => state.visits)
  const recent = visits.slice(0, RECENT_PAGES)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkbenchToolbar density="compact" aria-label="New tab" className="gap-1">
        <PreviewAddressBar url="" onNavigate={onOpen} startFocused />
      </WorkbenchToolbar>
      {recent.length === 0 ? (
        <StateNotice
          className="flex-1"
          icon={Globe2}
          title="New tab"
          body="Type an address or a search above."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <section aria-labelledby={headingId} className="p-3">
            <div className="flex items-center justify-between gap-2 px-1 pb-1">
              <h2
                id={headingId}
                className="text-2xs font-medium uppercase tracking-wide text-text-faint"
              >
                Recently visited
              </h2>
              <Button variant="ghost" size="sm" className="text-text-soft" onClick={onOpenHistory}>
                All history
              </Button>
            </div>
            <ul className="flex flex-col gap-px">
              {recent.map((visit) => (
                <li key={visit.url}>
                  <BrowserVisitRow visit={visit} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  )
}
