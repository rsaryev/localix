import { cn } from '@localixai/mini-app-sdk/ui/classes'

/**
 * Shared stat-dashboard primitives, reused by the Usage page and mini app stats
 * tabs (through the kit). They carry the visual identity (quiet rules, a mono
 * number and a tracked uppercase label) so every dashboard stays in lockstep.
 *
 * Layout (how many columns, when they collapse) is left to the consumer — wrap
 * the grid in an `@container` and use `@`-prefixed column utilities so the
 * dashboard reflows to its OWN width, not the viewport (it may sit in a narrow
 * docked panel or fill the screen).
 */

/** A single metric: tracked label (optional status dot) over a mono value. */
export function StatCard({
  label,
  value,
  dot,
  hint,
  hintTone = 'muted',
  title,
}: {
  label: string
  value: string | number
  /** Tailwind bg-* class for a leading status dot. */
  dot?: string
  /** Small note shown beside the value (e.g. "of input", "actual"). */
  hint?: string
  hintTone?: 'good' | 'muted'
  /** Native tooltip text (used for metrics whose meaning needs a hint). */
  title?: string
}) {
  return (
    <div className="border-t border-border-soft px-1 py-3" title={title}>
      <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-widest text-text-soft">
        {dot && <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="font-mono text-2xl tabular-nums text-foreground">{value}</span>
        {hint && (
          <span
            className={cn(
              'whitespace-nowrap text-xs',
              hintTone === 'good' ? 'text-status-success/80' : 'text-text-faint',
            )}
          >
            {hint}
          </span>
        )}
      </div>
    </div>
  )
}

/** A titled dashboard section bounded by quiet horizontal rules. */
export function StatSection({
  title,
  action,
  children,
}: {
  title: string
  /** Optional control rendered at the right of the header (e.g. a refresh button). */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="border-y border-border-soft py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-2xs font-medium uppercase tracking-widest text-text-soft">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
