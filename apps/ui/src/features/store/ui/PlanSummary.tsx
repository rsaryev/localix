import { CircleAlert, Globe, Terminal } from 'lucide-react'
import type { Listing, Scope } from '@localixai/store'
import { Skeleton } from '@localixai/kit/skeleton'
import { COMPONENT_LABELS, plural } from '../model/presentation'
import { useStoreScope } from '../model/storeContext'
import { useInstallPlan } from '../model/useStoreData'

function Heading({ children }: { children: string }) {
  return <h3 className="text-xs font-semibold text-foreground">{children}</h3>
}

/**
 * What installing a package does, from its plan (`docs/internals/store.md`, "Plan"): what it
 * would run on this computer and with which command, which hosts it reaches, what it adds, and
 * what the source warns about. Reading the plan may fetch the package; it shows its outline
 * meanwhile.
 */
export function PlanSummary({ listing, scope = 'user' }: { listing: Listing; scope?: Scope }) {
  const store = useStoreScope()
  const { data: plan, error } = useInstallPlan(
    store.client,
    listing.ref,
    scope,
    store.project?.id ?? null,
    true,
  )
  if (error) return <p className="text-xs text-text-soft">What it would run could not be read.</p>
  if (!plan)
    return (
      <div role="status" aria-label="Reading what it would run" className="flex flex-col gap-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    )
  const adds = Object.entries(
    plan.adds.reduce<Record<string, number>>((counts, part) => {
      counts[part.kind] = (counts[part.kind] ?? 0) + 1
      return counts
    }, {}),
  )
  return (
    <div className="flex max-w-(--reading-measure) flex-col gap-4 text-sm">
      {plan.warnings.length > 0 && (
        <ul className="flex flex-col gap-1">
          {plan.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2 text-xs text-text-soft">
              <CircleAlert className="mt-px size-3.5 shrink-0 text-status-warning" aria-hidden />
              {warning}
            </li>
          ))}
        </ul>
      )}
      <section className="flex flex-col gap-1.5">
        <Heading>Runs on this computer</Heading>
        {plan.runs.length === 0 ? (
          <p className="text-xs text-text-soft">Nothing: it adds text and settings only.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {plan.runs.map((run) => {
              const Icon = COMPONENT_LABELS[run.kind]?.icon ?? Terminal
              return (
                <li key={`${run.kind}:${run.name}`} className="flex min-w-0 items-start gap-2">
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-text-faint" aria-hidden />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-xs text-foreground">
                      {COMPONENT_LABELS[run.kind].one} · {run.name}
                    </span>
                    {run.command && (
                      <code
                        className="truncate font-mono text-2xs text-text-soft"
                        title={run.command}
                      >
                        {run.command}
                      </code>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {plan.network.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <Heading>Reaches</Heading>
          <ul className="flex flex-wrap gap-1.5">
            {plan.network.map((host) => (
              <li
                key={host}
                className="inline-flex items-center gap-1 rounded-sm bg-field-fill px-1.5 py-0.5 font-mono text-2xs text-text-soft"
              >
                <Globe className="size-3" aria-hidden />
                {host}
              </li>
            ))}
          </ul>
        </section>
      )}
      {adds.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <Heading>Adds</Heading>
          <p className="text-xs text-text-soft">
            {adds
              .map(([kind, count]) => {
                const { one, many } = COMPONENT_LABELS[kind as keyof typeof COMPONENT_LABELS]
                return count === 1 ? `1 ${one.toLowerCase()}` : plural(count, one, many)
              })
              .join(' · ')}
          </p>
        </section>
      )}
    </div>
  )
}
