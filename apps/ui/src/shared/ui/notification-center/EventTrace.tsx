import { ArrowUpRight } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { EventTraceStep, NotificationOrigin } from '@/shared/lib/notifications/types'
import { EventTimestamp, TRACE_PHASE_CLASS } from './eventPresentation'

/** A step's data rows — minus `cause`, which the step already shows as its own label. */
function dataOf(step: EventTraceStep) {
  return Object.entries(step.attributes ?? {}).filter(([key]) => key !== 'cause')
}

/** The causal steps recorded before an event, oldest first; a resource step opens its source. */
export function EventTrace({
  trace,
  onOpenTrace,
}: {
  trace: readonly EventTraceStep[]
  onOpenTrace: (origin: NotificationOrigin) => void
}) {
  return (
    <div className="mt-2.5">
      <p className="text-2xs font-medium text-text-faint">Trace</p>
      <ol className="mt-1.5 border-l border-border-soft pl-3 text-2xs text-text-faint">
        {trace.map((step) => (
          <li key={step.id} className="relative pb-2 last:pb-0">
            <span
              className={cn(
                'absolute -left-[0.94rem] top-1 size-1.5 rounded-full bg-control-border-hover',
                step.phase && TRACE_PHASE_CLASS[step.phase],
              )}
            />
            <div className="flex min-w-0 items-baseline gap-2">
              <code className="shrink-0 rounded-sm bg-foreground/[0.04] px-1 text-2xs text-text-faint">
                {step.kind}
              </code>
              <span className="min-w-0 flex-1 break-words text-text-soft">
                {step.summary}
                {/* The failed call's status, in the line: it was folded away under "Data", so a
                    503 read the same as a 400 until someone thought to expand it. */}
                {typeof step.attributes?.status === 'number' && step.phase === 'failed' && (
                  <span className="ml-1.5 font-mono text-status-error">
                    {step.attributes.status}
                  </span>
                )}
              </span>
              {/* The step the producer NAMED as this event's cause — not merely nearby in time. */}
              {step.attributes?.cause === true && (
                <span className="shrink-0 rounded-sm bg-status-error/10 px-1 text-2xs text-status-error">
                  Cause
                </span>
              )}
              {step.durationMs != null && (
                <span className="shrink-0 font-mono text-2xs text-text-faint">
                  {Math.max(0, Math.round(step.durationMs))}ms
                </span>
              )}
              <EventTimestamp ts={step.ts} className="shrink-0 font-mono" />
            </div>
            {step.origin.kind === 'resource' && (
              <button
                type="button"
                onClick={() => onOpenTrace(step.origin)}
                aria-label={`Open trace resource ${step.origin.resourceKind} ${step.origin.resourceId}`}
                className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded-sm font-mono text-2xs text-text-faint outline-none hover:text-foreground focus-ring"
              >
                <span className="truncate">
                  {step.origin.resourceKind} · {step.origin.resourceId}
                </span>
                <ArrowUpRight className="size-2.5 shrink-0" aria-hidden="true" />
              </button>
            )}
            {dataOf(step).length > 0 && (
              <details className="mt-1 rounded-md bg-foreground/[0.025] text-2xs [&_summary::-webkit-details-marker]:hidden">
                <summary className="cursor-pointer select-none rounded-sm px-2 py-1 font-medium text-text-faint outline-none hover:text-text-soft focus-ring">
                  Data · {dataOf(step).length}
                </summary>
                <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-0.5 border-t border-border-faint px-2 py-1.5 font-mono">
                  {dataOf(step).map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-text-faint">{key}</dt>
                      <dd className="min-w-0 break-all text-text-soft">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
