import { ChevronRight, CircleAlert, ListTree } from 'lucide-react'
import { Spinner } from '@localixai/kit/spinner'
import { formatDuration } from '@localixai/mini-app-sdk/ui/utilities'
import { COLLAPSIBLE_MOTION } from '@localixai/kit/collapsible-motion'
import { DiffStat } from './ToolIO'

/** What a cluster's summary line reads from its calls, computed once per change of the run. */
export interface ChainAggregate {
  isLive: boolean
  errorCount: number
  doneCount: number
  totalMs: number
  title: string
  diffStats: { additions: number; deletions: number }
}

/**
 * The summary line of a run of 2+ tool calls: the live aggregate ("Reading 1 file, running 2
 * commands… · 1/3") while it runs, the digest ("Read 3 files, ran 2 commands · 12.4s") after.
 * It is the chain's only toggle; the chain decides when it is open.
 */
export function ToolChainHeader({
  aggregate,
  expanded,
  count,
  onToggle,
}: {
  aggregate: ChainAggregate
  expanded: boolean
  count: number
  onToggle: () => void
}) {
  const { isLive, errorCount, doneCount, totalMs, title, diffStats } = aggregate
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={`${expanded ? 'Collapse' : 'Expand'} tool chain, ${title}`}
      className={`flex w-full min-h-[var(--chrome-control-md)] cursor-pointer items-center gap-1.5 rounded-lg border-none bg-transparent px-1.5 py-[0.32rem] text-left outline-none focus-ring ${COLLAPSIBLE_MOTION.header} hover:bg-surface-hover`}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-text-faint">
        {isLive ? <Spinner size="xs" /> : <ListTree className="size-[0.68rem]" />}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-soft">{title}</span>
      <span className="flex shrink-0 items-center gap-1.5 text-2xs text-text-faint">
        <DiffStat additions={diffStats.additions} deletions={diffStats.deletions} />
        {isLive && (
          <span className="tabular-nums">
            {doneCount}/{count}
          </span>
        )}
        {errorCount > 0 && !isLive && (
          <span className="flex items-center gap-1 font-medium text-status-error">
            <CircleAlert className="size-3" aria-hidden="true" />
            {errorCount} failed
          </span>
        )}
        {!isLive && totalMs > 0 && <span className="tabular-nums">{formatDuration(totalMs)}</span>}
        <ChevronRight
          className={[
            `size-[0.66rem] ${COLLAPSIBLE_MOTION.chevron}`,
            expanded ? 'rotate-90' : '',
          ].join(' ')}
        />
      </span>
    </button>
  )
}
