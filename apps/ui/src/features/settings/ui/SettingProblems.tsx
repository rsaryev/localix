import type { ProblemConsequence } from '@localixai/mini-app-sdk/ui'
import { ProblemLine, useProblemReport } from '@/shared/ui/problem-report'

const NO_MESSAGES: readonly string[] = []

/** Namespace for everything settings puts in the Event Center. */
const PROBLEM_SCOPE = 'settings'

/**
 * The one way a settings surface says something is wrong: a line here, the whole report in the
 * Event Center, and Retry in both places so the durable row is not a dead end.
 *
 * Hand it no problems and it settles the row it published — which is why call sites keep it
 * mounted and empty rather than dropping it when the failure clears.
 */
export function SettingProblems({
  subject,
  errors = NO_MESSAGES,
  warnings = NO_MESSAGES,
  onRetry,
  className,
  consequence,
}: {
  /** What the problems are about: the tab's name, or the record the row shows. */
  subject: string
  /**
   * What the problems mean for the surface. Omitted = the shared `stale` default; a record row
   * whose findings do not mean "showing an older version" passes `none`.
   */
  consequence?: ProblemConsequence
  errors?: readonly string[]
  warnings?: readonly string[]
  onRetry?: () => void
  className?: string
}) {
  const problems = [
    ...errors.map((message) => ({ severity: 'error' as const, message })),
    ...warnings.map((message) => ({ severity: 'warning' as const, message })),
  ]
  const problem = useProblemReport(
    problems.length
      ? { subject: { label: subject }, problems, ...(consequence ? { consequence } : {}) }
      : null,
    {
      scope: PROBLEM_SCOPE,
      sourceVisible: true,
      actions: onRetry ? [{ id: 'retry', label: 'Retry', run: onRetry }] : undefined,
    },
  )

  if (!problem) return null
  return <ProblemLine {...problem} className={className} />
}
