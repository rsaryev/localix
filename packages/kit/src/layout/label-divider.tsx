import type { ReactNode } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'

/**
 * A rule with a label in its middle — "Today" above a day's messages, "or" between two ways to
 * connect, a note that a run was cut short.
 *
 * Three places drew this shape by hand, each with its own line alpha (40, 50, 55%), its own gap
 * and its own letter-spacing, so the same divider looked like three different things in one
 * window. The label is the content; the two hairlines are the soft border step, the type is the
 * section-label voice (2xs, uppercase, faint).
 *
 * `separator` role by default: the label marks where one part ends and the next begins. A caller
 * whose label is itself a landmark — a `<time>` — passes it as the child and keeps the role.
 */
export function LabelDivider({
  children,
  className,
  role = 'separator',
}: {
  children: ReactNode
  className?: string
  role?: 'separator' | 'presentation'
}) {
  return (
    <div
      role={role}
      className={cn(
        'flex w-full select-none items-center gap-3 text-2xs font-medium uppercase tracking-wider text-text-faint',
        className,
      )}
    >
      <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
      <span className="shrink-0">{children}</span>
      <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
    </div>
  )
}
