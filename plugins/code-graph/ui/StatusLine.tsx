import { Info } from 'lucide-react'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@localixai/kit/tooltip'
import { WorkbenchStatusBar, WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'
import { percent } from '../shared/format'
import type { GraphSnapshot } from '../shared/view'

/**
 * The quiet facts under the map: how big the project is, how much of it the map can see, and
 * whether it is refreshing. The coverage explanation is one hover away rather than a paragraph on
 * screen — it matters when a "used by" list looks empty, not the rest of the time.
 */
export function StatusLine({ snapshot }: { snapshot: GraphSnapshot }) {
  const { stats, status } = snapshot
  const progress = status.progress
  const shownChildren = snapshot.view?.nodes.filter((node) => node.role === 'child').length ?? 0
  return (
    <WorkbenchStatusBar aria-label="Code graph status" className="h-7">
      {status.state === 'indexing' ? (
        <WorkbenchStatusItem className="gap-2">
          {status.phase === 'parsing' && progress && progress.total > 0 ? (
            <>
              Parsing {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
              <ProgressBar
                value={(progress.done / progress.total) * 100}
                className="h-1 w-16"
                aria-label="Indexing progress"
              />
            </>
          ) : status.phase === 'linking' ? (
            'Linking…'
          ) : (
            'Reading the project…'
          )}
        </WorkbenchStatusItem>
      ) : status.error ? (
        <WorkbenchStatusItem className="text-status-warning" title={status.error}>
          Last refresh failed
        </WorkbenchStatusItem>
      ) : null}
      {stats && (
        <>
          <WorkbenchStatusItem>
            {stats.files.toLocaleString()} files · {stats.symbols.toLocaleString()} symbols
          </WorkbenchStatusItem>
          <Tooltip>
            <TooltipTrigger asChild>
              <WorkbenchStatusItem
                tabIndex={0}
                className="cursor-help gap-1 outline-none focus-ring"
              >
                {percent(stats.calls.resolved, stats.calls.total)} of calls linked
                <Info aria-hidden className="size-3" />
              </WorkbenchStatusItem>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-72 text-2xs leading-4">
              Imports resolved:{' '}
              {percent(stats.imports.internal + stats.imports.external, stats.imports.total)}.
              Calls: {percent(stats.calls.resolved, stats.calls.total)} linked to project code,{' '}
              {percent(stats.calls.external, stats.calls.total)} into dependencies, the rest
              unresolved. The map reads syntax and stated types; a method called on a value whose
              type the code does not state is not linked.
            </TooltipContent>
          </Tooltip>
          {snapshot.status.omitted > 0 && (
            <WorkbenchStatusItem>
              {snapshot.status.omitted.toLocaleString()} files over the limit
            </WorkbenchStatusItem>
          )}
        </>
      )}
      {snapshot.view && snapshot.view.truncated > 0 && (
        <WorkbenchStatusItem title="Use search to open items beyond this level's preview.">
          {shownChildren}/{shownChildren + snapshot.view.truncated} shown · search for more
        </WorkbenchStatusItem>
      )}
    </WorkbenchStatusBar>
  )
}
