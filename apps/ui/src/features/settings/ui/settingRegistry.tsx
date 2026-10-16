import { cn } from '@localixai/plugin-sdk/ui/classes'
import type { ProblemConsequence, StatusTone } from '@localixai/plugin-sdk/ui'
import { Fragment, type ReactNode } from 'react'
import { ActivityOrb } from '@localixai/kit/activity-orb'
import { StatusDot } from '@localixai/kit/status-dot'
import { ProblemLine, useProblemReport } from '@/shared/ui/problem-report'
import { useUiTarget } from '@/shared/hooks/useUiTarget'
import { SettingsRows } from './SettingsScaffold'

export type SettingRegistryState = 'enabled' | 'disabled' | 'neutral' | 'warning' | 'error'
/** The app's one tone union (`StatusTone`), so a fact keeps its tone between surfaces. */
export type SettingRegistryMetaTone = StatusTone

export interface SettingRegistryMetaItem {
  label: string
  tone?: SettingRegistryMetaTone
  title?: string
}

const STATUS_CLASS: Record<SettingRegistryState, string> = {
  enabled: 'bg-status-success',
  disabled: 'bg-muted-foreground/30',
  neutral: 'bg-muted-foreground/55',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
}

/**
 * Transparent registry list for extension-like capabilities. A pair of quiet
 * rules defines the collection; rows are separated without turning every
 * record into its own card or surface.
 */
export function SettingRegistryList({ children }: { children: ReactNode }) {
  return <SettingsRows role="list">{children}</SettingsRows>
}

/**
 * A registry is empty only after a successful, settled load.
 *
 * There used to be a fourth condition — "and its editor is not open" — because the editor
 * was an inline panel ABOVE the list, and "no skills here yet" printed under the form you
 * were using to add one. Editors are modals now, so the list behind one is simply the list,
 * and a state that has to be suppressed while a form is open no longer exists.
 */
export function shouldShowRegistryEmptyState({
  count,
  loading,
  error,
}: {
  count: number
  loading: boolean
  error: string | null
}) {
  return count === 0 && !loading && !error
}

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

const META_TONE_CLASS: Record<SettingRegistryMetaTone, string> = {
  neutral: 'text-text-faint',
  info: 'text-status-info',
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
}

/**
 * Quiet dot-separated facts for registry rows. These are descriptive metadata,
 * not selectable filters or independent statuses, so they deliberately avoid
 * pill backgrounds and let the row's status dot carry the primary state.
 */
export function SettingRegistryMeta({ items }: { items: readonly SettingRegistryMetaItem[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs">
      {items.map((item, index) => (
        <Fragment key={`${index}:${item.label}`}>
          {index > 0 && (
            <span className="text-border" aria-hidden="true">
              ·
            </span>
          )}
          <span className={META_TONE_CLASS[item.tone ?? 'neutral']} title={item.title}>
            {item.label}
          </span>
        </Fragment>
      ))}
    </div>
  )
}

/**
 * Shared row shell for extension-like capabilities: stable status slot,
 * hover/focus actions, an optional primary control, and expandable content.
 * While a mutation is running the status dot becomes the same Localix activity
 * orb used by tools and full-pane loading states, without shifting the title.
 */
export function SettingRegistryRow({
  state,
  busyLabel,
  leading,
  header,
  actions,
  toggle,
  anchor,
  uiTargetUri,
  children,
}: {
  state: SettingRegistryState
  /** Present only while this record is being mutated; announced as a polite status. */
  busyLabel?: string
  /**
   * An identity mark shown before the title (an agent's monogram, say).
   *
   * It shares the middle column rather than claiming a fourth one, so a registry that has no
   * mark keeps exactly the alignment it has today instead of carrying an empty gutter.
   */
  leading?: ReactNode
  /** Title + metadata + subtitle — fills the flexible middle column. */
  header: ReactNode
  /** Hover/focus-revealed secondary actions (Configure / Remove …). Optional. */
  actions?: ReactNode
  /** The always-visible primary control (usually an enable Switch). */
  toggle?: ReactNode
  /** Optional deep-link target used by settings search and cross-workspace navigation. */
  anchor?: string
  /** Canonical URI registered with the application-wide UI target registry. */
  uiTargetUri?: string
  /** Expandable content rendered below the row (issues, tool list, config). */
  children?: ReactNode
}) {
  const busy = Boolean(busyLabel)
  const targetRef = useUiTarget<HTMLDivElement>(uiTargetUri)

  return (
    <div
      ref={targetRef}
      role="listitem"
      tabIndex={uiTargetUri ? -1 : undefined}
      aria-busy={busy || undefined}
      data-settings-anchor={anchor}
      data-state={busy ? 'busy' : state}
      className="group py-3"
    >
      <div
        className={cn(
          'grid items-center gap-x-3 gap-y-2',
          // A row with an identity mark drops the status column: the mark already opens the
          // row, and a dot in front of it is a second, quieter answer to the same question the
          // row's own control gives. Busy takes the mark's place rather than the dot's.
          leading
            ? 'grid-cols-[minmax(0,1fr)_auto] @max-md:grid-cols-[minmax(0,1fr)]'
            : 'grid-cols-[0.5rem_minmax(0,1fr)_auto] @max-md:grid-cols-[0.5rem_minmax(0,1fr)]',
        )}
      >
        {!leading && (
          <div className="relative flex size-2 items-center justify-center">
            {busy ? (
              <ActivityOrb className="absolute size-3.5" />
            ) : (
              <StatusDot size="md" className={STATUS_CLASS[state]} />
            )}
          </div>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {leading && (busy ? <ActivityOrb className="size-7" /> : leading)}
          <div className="min-w-0 flex-1">
            {header}
            {busyLabel && (
              <p className="mt-1 truncate text-2xs text-text-soft" role="status">
                {busyLabel}
              </p>
            )}
          </div>
        </div>
        {(actions || toggle) && (
          <div
            className={cn(
              'flex shrink-0 items-center gap-1.5 @max-md:row-start-2 @max-md:justify-self-end',
              leading ? '@max-md:col-start-1' : '@max-md:col-start-2',
            )}
          >
            {actions && (
              <div className="lx-hover-actions flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 @max-md:opacity-100">
                {actions}
              </div>
            )}
            {toggle}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}
