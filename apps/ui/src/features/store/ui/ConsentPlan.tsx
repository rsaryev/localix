import { Fragment, type ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { Skeleton } from '@localixai/kit/skeleton'
import { COMPONENT_LABELS, plural } from '../model/presentation'
import type { useListingPlan } from './PlanSummary'
import { StoreReadFailure } from './StoreReadFailure'

/** "a, b and c". */
const listed = (items: readonly string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

/**
 * What the consent sheet asks a yes for, read at a glance: the source's warnings first, as one list
 * to heed, then what it adds, what runs on this computer (each run's command on hover; the
 * package's Permissions tab lists them in full) and the hosts it reaches, each under its own word.
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
    <div className="flex flex-col gap-3 text-xs/relaxed text-text-soft">
      {plan.warnings.length > 0 && (
        // The signal is the glyph's; the ground stays a quiet veil (`WorkbenchNoticeBar`).
        <ul
          aria-label="Before you install"
          className="flex flex-col gap-1.5 rounded-lg bg-foreground/[0.04] px-3 py-2.5"
        >
          {plan.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2">
              <CircleAlert
                className="mt-[0.1875rem] size-3.5 shrink-0 text-status-warning"
                aria-hidden
              />
              <span className="min-w-0 text-pretty">{warning}</span>
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 px-3">
        {adds.length > 0 && <Fact term="Adds">{listed(adds)}</Fact>}
        <Fact term="Runs">
          {plan.runs.length === 0 ? (
            'Nothing on this computer'
          ) : (
            <>
              {plan.runs.map((run, index) => (
                <Fragment key={`${run.kind}:${run.name}`}>
                  {index > 0 && (index === plan.runs.length - 1 ? ' and ' : ', ')}
                  <span className="text-foreground" title={run.command}>
                    {run.name} {COMPONENT_LABELS[run.kind].one.toLowerCase()}
                  </span>
                </Fragment>
              ))}
              , on this computer
            </>
          )}
        </Fact>
        {plan.network.length > 0 && (
          <Fact term="Reaches">
            <span className="text-foreground">{listed(plan.network)}</span>
          </Fact>
        )}
      </dl>
    </div>
  )
}

/** One named fact of the plan: its word in the quiet column, what it says beside it. */
function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-text-faint">{term}</dt>
      <dd className="min-w-0 text-pretty">{children}</dd>
    </>
  )
}
