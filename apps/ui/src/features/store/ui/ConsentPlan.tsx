import { Fragment } from 'react'
import { CircleAlert } from 'lucide-react'
import { Skeleton } from '@localixai/kit/skeleton'
import { COMPONENT_LABELS, plural } from '../model/presentation'
import type { useListingPlan } from './PlanSummary'
import { StoreReadFailure } from './StoreReadFailure'

/** "a, b and c". */
const listed = (items: readonly string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

/**
 * What the consent sheet asks a yes for, in a sentence or two read at a glance: the source's
 * warnings, what runs on this computer (each run's command on hover; the package's Permissions tab
 * lists them in full), the hosts it reaches and what it adds.
 */
export function ConsentPlan({ plan, error, retry }: ReturnType<typeof useListingPlan>) {
  if (error && !plan)
    return <StoreReadFailure inline what="What it would run" error={error} onRetry={retry} />
  if (!plan)
    return (
      <div role="status" aria-label="Reading what it would run" className="flex flex-col gap-2">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    )
  const counts = new Map<string, number>()
  for (const part of plan.adds) counts.set(part.kind, (counts.get(part.kind) ?? 0) + 1)
  const adds = [...counts].map(([kind, count]) => {
    const { one, many } = COMPONENT_LABELS[kind as keyof typeof COMPONENT_LABELS]
    return plural(count, one.toLowerCase(), many.toLowerCase())
  })
  return (
    <div className="flex flex-col gap-1.5 text-center text-xs/relaxed text-balance text-text-soft">
      {plan.warnings.map((warning) => (
        <p key={warning}>
          <CircleAlert
            className="mr-1.5 inline size-3.5 -translate-y-px text-status-warning"
            aria-hidden
          />
          {warning}
        </p>
      ))}
      <p>
        {plan.runs.length === 0 ? (
          'Runs nothing on this computer.'
        ) : (
          <>
            Runs on this computer:{' '}
            {plan.runs.map((run, index) => (
              <Fragment key={`${run.kind}:${run.name}`}>
                {index > 0 && (index === plan.runs.length - 1 ? ' and ' : ', ')}
                <span className="text-foreground" title={run.command}>
                  {COMPONENT_LABELS[run.kind].one.toLowerCase()} {run.name}
                </span>
              </Fragment>
            ))}
            .
          </>
        )}
        {plan.network.length > 0 && (
          <>
            {' '}
            Reaches <span className="text-foreground">{listed(plan.network)}</span>.
          </>
        )}
      </p>
      {adds.length > 0 && <p>Adds {listed(adds)}.</p>}
    </div>
  )
}
