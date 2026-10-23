import type { ComponentType } from 'react'
import { Button } from '@localixai/kit/button'
import { StateNotice } from '@localixai/kit/state-notice'
import {
  problemReportTitle,
  worstProblemSeverity,
  type ProblemRecovery,
  type ProblemReport,
} from '@localixai/mini-app-sdk/ui/problems'

import { ProblemLinks } from './ProblemLine'
import { PROBLEM_SEVERITY } from './severity'

export interface ProblemStateProps {
  report: ProblemReport
  /** Id of the Event Center entry this report published, so "Details" lands on it. */
  entryId?: string
  actions?: readonly ProblemRecovery[]
  /** The subject's own icon (a whale, a database). Defaults to the severity's. */
  icon?: ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>
  className?: string
}

/**
 * A problem that IS the pane: nothing else can render until it is fixed.
 *
 * Seven mini apps each hand-built this as `<div className="flex-1 items-center justify-center">`
 * around a `ProblemLine` — and in a block-level scroll container `flex-1` is a no-op, so the
 * "centred" failure sat at the top of an empty pane (the DevOps sidebar, reported). `StateNotice`
 * is the kit's one centred shell and fills its parent in block and flex layouts alike, so the
 * geometry is decided once, here.
 *
 * Shape, in reading order: the headline; the one-sentence hint (what to do); the expected next step
 * as the surface's recommended button — Install Docker, Start Docker — when the report has one; then
 * the same quiet links the line has (Retry, Details). The engine's own words stay in the Event
 * Center, exactly as for the line.
 */
export function ProblemState({ report, entryId, actions, icon, className }: ProblemStateProps) {
  if (!report.problems.length) return null
  const severity = PROBLEM_SEVERITY[worstProblemSeverity(report.problems)]
  const primary = actions?.find((action) => action.primary)
  const rest = actions?.filter((action) => action !== primary)
  const hint = report.problems.length === 1 ? report.problems[0]!.hint : undefined

  return (
    <StateNotice
      role="alert"
      icon={icon ?? severity.Icon}
      title={problemReportTitle(report)}
      body={hint}
      bodyClassName="max-w-sm select-text"
      className={className}
      actions={
        <span className="flex flex-col items-center gap-2">
          {primary && (
            <Button size="sm" variant="outline" recommended onClick={() => void primary.run()}>
              {primary.label}
            </Button>
          )}
          <ProblemLinks entryId={entryId} actions={rest} className="justify-center" />
        </span>
      }
    />
  )
}
