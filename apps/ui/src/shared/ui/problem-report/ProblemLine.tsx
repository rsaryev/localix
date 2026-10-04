import type { ReactNode } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import {
  problemConsequenceLabel,
  problemReportTitle,
  worstProblemSeverity,
  type ProblemRecovery,
  type ProblemReport,
} from '@localixai/plugin-sdk/ui/problems'

import { openNotificationCenter } from '@/shared/lib/notificationCenterBus'
import { PROBLEM_SEVERITY } from './severity'

export interface ProblemLineProps {
  report: ProblemReport
  /** Id of the Event Center entry this report published, so "Details" lands on it. */
  entryId?: string
  /**
   * The ways out — Retry, Dismiss, Reconnect — as data, not markup. Spread what
   * `useProblemReport` returned and this is already the list the Event Center row got, so the two
   * cannot disagree and no call site maps anything to a button by hand.
   */
  actions?: readonly ProblemRecovery[]
  className?: string
}

const LINK = 'text-2xs text-text-faint underline-offset-2 hover:text-foreground hover:underline'

/** One recovery link. Quiet by design: the failure is the message, not the button. */
function ProblemAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={LINK}>
      {children}
    </button>
  )
}

/** The primary step first — it is the one a person scans for — then the rest in declared order. */
export function orderedRecoveries(
  actions: readonly ProblemRecovery[] | undefined,
): ProblemRecovery[] {
  return [...(actions ?? [])].sort((a, b) => Number(!!b.primary) - Number(!!a.primary))
}

/**
 * "Details" into the Event Center, then each way out — the row of quiet links both problem shapes
 * end with, so the line and the pane cannot offer different lists.
 */
export function ProblemLinks({
  entryId,
  actions,
  className,
}: {
  entryId?: string
  actions?: readonly ProblemRecovery[]
  className?: string
}) {
  return (
    <span className={cn('flex flex-wrap items-center gap-2.5', className)}>
      <button type="button" onClick={() => openNotificationCenter(entryId)} className={LINK}>
        Details
      </button>
      {orderedRecoveries(actions).map((action) => (
        <ProblemAction key={action.id} onClick={() => void action.run()}>
          {action.label}
        </ProblemAction>
      ))}
    </span>
  )
}

/**
 * The ONLY way a surface says something is wrong.
 *
 * One line, and "Details" quietly under it. Not a card, not a strip, not a panel — the report
 * itself (every field, every line, the engine's own words) lives in the Event Center, which already
 * renders all of that and is the one place a person can find a problem they were not watching when
 * it happened. Repeating it on the surface was the mistake: it produced a different-looking report
 * per feature, and none of them were reachable five seconds later.
 *
 * Recovery is the one thing that belongs in both places, so it is passed as DATA and rendered here
 * and there from the same list — never as markup a call site assembles, which is how a Retry ended
 * up on the pane and nowhere in the record of it.
 *
 * Alignment is the parent's: a pane centres it, a toolbar does not. The component only owns the two
 * facts it has — that something is wrong, and where to read about it.
 */
export function ProblemLine({ report, entryId, actions, className }: ProblemLineProps) {
  if (!report.problems.length) return null
  const { Icon, color, label } = PROBLEM_SEVERITY[worstProblemSeverity(report.problems)]
  // Empty for everything but a stale surface — see `problemConsequenceLabel`, which owns that rule.
  const stale = problemConsequenceLabel(report)

  return (
    <div role="alert" className={cn('flex min-w-0 flex-col gap-1', className)}>
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-text-soft">
        <Icon className={cn('size-3.5 shrink-0', color)} strokeWidth={2} aria-hidden />
        <span className="sr-only">{label}: </span>
        <span className="min-w-0 truncate">{problemReportTitle(report)}</span>
        {stale && <span className="shrink-0 text-2xs text-text-faint">{stale}</span>}
      </p>
      <ProblemLinks entryId={entryId} actions={actions} />
    </div>
  )
}
