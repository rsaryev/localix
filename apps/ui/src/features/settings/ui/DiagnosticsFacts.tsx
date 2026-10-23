import { Fragment, type ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { StatusTone } from '@localixai/mini-app-sdk/ui'
import type { ConfigDiagnosticSeverity } from '@localixai/api/client'
import { PROBLEM_SEVERITY } from '@/shared/ui/problem-report'
import { StatusDot } from '@localixai/kit/status-dot'

/**
 * The small vocabulary every section of the diagnostics report is written in: a run of dotted
 * facts, the caption above a group of them, and a problem's severity glyph. Kept apart from the
 * sections so each section reads as what it reports rather than how a fact is drawn.
 */
export type FactTone = StatusTone

const FACT_TONE_CLASS: Record<FactTone, string> = {
  neutral: 'text-text-soft',
  info: 'text-status-info',
  warning: 'text-status-warning',
  error: 'text-status-error',
  success: 'text-status-success',
}

/** The caption above a group of facts ("Enabled (12)", "Skill overrides"). One label, four uses. */
export const FACT_GROUP_LABEL = 'mb-1.5 text-xs font-medium text-text-soft'

export function InlineFacts({
  items,
  className,
}: {
  items: Array<{
    key: string
    label: ReactNode
    tone?: FactTone
    title?: string
    dotClass?: string
  }>
  className?: string
}) {
  return (
    <span
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-text-soft',
        className,
      )}
    >
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 && (
            <span className="text-border" aria-hidden="true">
              ·
            </span>
          )}
          {item.dotClass && <StatusDot className={item.dotClass} />}
          <span className={FACT_TONE_CLASS[item.tone ?? 'neutral']} title={item.title}>
            {item.label}
          </span>
        </Fragment>
      ))}
    </span>
  )
}

/** The app's severity table, not a second one: these rows list problems like every other surface. */
export function DiagnosticIcon({ severity }: { severity: ConfigDiagnosticSeverity }) {
  const { Icon, color } = PROBLEM_SEVERITY[severity]
  return <Icon className={cn('size-4 shrink-0', color)} aria-hidden />
}
