import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ProgressBar } from '@localixai/kit/progress-bar'

import type { BoardSummary } from './utils'

/**
 * Thin glanceability header over the board view: completion as the kit's progress bar, then the
 * done/active/blocked counts across the tasks currently in view. Read-only — it summarizes the same
 * filtered set the columns render, so triage state is legible without opening Stats. Hidden when
 * the view has no tasks.
 *
 * The bar is completion alone, the one quantity its label names; active and blocked are the
 * counts beside it. It was a hand-drawn three-colour strip, the only multi-segment bar in the
 * product, beside the kit's bar that every other progress readout uses.
 */
export function BoardProgress({ summary }: { summary: BoardSummary }) {
  const { total, done, inProgress: active, blocked } = summary
  if (total === 0) return null
  const donePct = (done / total) * 100

  return (
    <div className="flex items-center gap-3 px-3 pt-1.5">
      <ProgressBar
        value={donePct}
        aria-label="Board completion"
        aria-valuenow={Math.round(donePct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 flex-1"
      />
      <div className="flex shrink-0 items-center gap-2.5 text-2xs tabular-nums text-text-faint">
        <span className="font-medium text-foreground">
          {done}/{total} done
        </span>
        {active > 0 && <Count className="text-status-warning" label="active" value={active} />}
        {blocked > 0 && <Count className="text-status-error" label="blocked" value={blocked} />}
      </div>
    </div>
  )
}

function Count({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <span className={cn('flex items-center gap-1', className)}>
      <span className="font-medium">{value}</span>
      <span className="text-text-faint">{label}</span>
    </span>
  )
}
