import { cn } from '@localixai/mini-app-sdk/ui/classes'

import { PROBLEM_SEVERITY } from '@/shared/ui/problem-report'

/**
 * Header roll-up for settings lists: a glanceable count of items that have
 * errors ("need attention") and/or warnings, so the user doesn't have to scan
 * every row to find the broken ones. Renders nothing when everything is clean.
 * Glyph and colour come from the app's severity table, so a count and the rows
 * it counts can never disagree about what an error looks like.
 */
export function AttentionRollup({
  errorCount,
  warningCount,
}: {
  errorCount: number
  warningCount: number
}) {
  if (errorCount === 0 && warningCount === 0) return null
  const error = PROBLEM_SEVERITY.error
  const warning = PROBLEM_SEVERITY.warning
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs" role="status">
      {errorCount > 0 && (
        <span
          className={cn('inline-flex items-center gap-1', error.color)}
          title="Items with errors — see the affected rows below"
        >
          <error.Icon className="size-3 shrink-0" aria-hidden />
          {errorCount} {errorCount === 1 ? 'needs' : 'need'} attention
        </span>
      )}
      {warningCount > 0 && (
        <span
          className={cn('inline-flex items-center gap-1', warning.color)}
          title="Items with warnings — see the affected rows below"
        >
          <warning.Icon className="size-3 shrink-0" aria-hidden />
          {warningCount} with warning{warningCount === 1 ? '' : 's'}
        </span>
      )}
    </div>
  )
}
