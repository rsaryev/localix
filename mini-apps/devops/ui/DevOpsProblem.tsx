import { useMemo } from 'react'
import { useProblemReport } from '@localixai/mini-app-sdk/ui'
import {
  prerequisiteProblem,
  usePrerequisiteRecovery,
} from '@localixai/mini-app-sdk/ui/prerequisite-recovery'
import { ProblemLine, ProblemState } from '@localixai/mini-app-sdk/ui/components'
import type { Prerequisite } from '@localixai/mini-app-sdk/prerequisite'
import type { Problem, ProblemReport, ProblemRequest } from '@localixai/mini-app-sdk/ui/problems'

/** Namespace for this mini app's rows in the Event Center. */
const SCOPE = 'devops'

export interface DevOpsIssue {
  code?: string
  message: string
  detail?: string
  /** Docker absent or stopped: the surface offers Install / Start instead of a bare Retry. */
  prerequisite?: Prerequisite
  /** The request that failed, so its Event Center row traces that call and no other. */
  request?: ProblemRequest
}

/**
 * The one failure surface Docker and Kubernetes have.
 *
 * It is the host's problem shape and nothing else: the line inside a populated pane, the pane state
 * (`centered`) when nothing else can render. The code and the operator detail live in the Event
 * Center, which is the only place a person can read them after the pane they were on has moved on.
 * Recovery is offered in both places, because retrying is done where the thing that failed is AND
 * from the record of it.
 *
 * `centered` used to be a hand-built `flex-1` wrapper, and inside the sidebar's block-level scroll
 * container `flex-1` is a no-op — the "centred" failure sat at the top of the empty pane. The host's
 * `ProblemState` owns that geometry now.
 *
 * Render this UNCONDITIONALLY and pass `issue={null}` when the thing is healthy. It draws nothing
 * in that state, and it is the only way the row it published gets settled — a `{error && …}` around
 * it unmounts exactly when the failure ends, which is when the centre needs to hear about it.
 */
export function DevOpsProblem({
  subject,
  title,
  issue,
  onRetry,
  onDismiss,
  centered = false,
}: {
  /** Short human name for what failed — a collection, a resource, an action. */
  subject: string
  /** Overrides the headline when the producer knows a better sentence than the daemon's. */
  title?: string
  issue: DevOpsIssue | null | undefined
  onRetry?: () => void
  onDismiss?: () => void
  /** Sole content of a pane: the centred pane state instead of a line in the flow. */
  centered?: boolean
}) {
  const recovery = usePrerequisiteRecovery(issue?.prerequisite)
  const report = useMemo<ProblemReport | null>(() => {
    if (!issue?.message) return null
    const { code, message, detail, prerequisite, request } = issue
    // An absent or stopped engine says WHICH and WHAT TO DO; the daemon's words stay the detail.
    const problem: Problem = prerequisite
      ? prerequisiteProblem(prerequisite, { code, detail, request })
      : { severity: 'error', message, detail, code, request }
    return {
      subject: { label: subject },
      problems: [problem],
      consequence: centered ? 'blocked' : 'stale',
      // The producer's sentence is still the better headline for a plain failure; for a
      // prerequisite the state ("Docker is not running") is.
      title: prerequisite ? undefined : title,
    }
  }, [subject, title, issue, centered])
  // Declared once: the line, the pane and the durable row render the same list. Dismiss is
  // surface-only — "stop showing me this" says nothing to a record read after the pane is gone.
  const actions = useMemo(
    () => [
      ...(recovery ? [recovery] : []),
      ...(onRetry ? [{ id: 'retry', label: 'Retry', run: onRetry }] : []),
      ...(onDismiss ? [{ id: 'dismiss', label: 'Dismiss', run: onDismiss, durable: false }] : []),
    ],
    [recovery, onRetry, onDismiss],
  )
  const problem = useProblemReport(report, { scope: SCOPE, sourceVisible: true, actions })
  if (!problem) return null
  if (centered) return <ProblemState {...problem} />
  return (
    <div className="px-3 py-2">
      <ProblemLine {...problem} />
    </div>
  )
}
