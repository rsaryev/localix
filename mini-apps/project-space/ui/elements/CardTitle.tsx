import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * The title row of a card the board makes (a snippet, a diagram): an icon, a name and a quiet
 * badge — the border, padding and type of a file card's header in one 32 px line (a file header
 * is taller: it carries the folder under the name), so a board's cards read as one family
 * whatever they hold. Diagram layouts reserve exactly `CARD_TITLE_PX` for it.
 */
export const CARD_TITLE_PX = 32

export function CardTitle({
  Icon,
  title,
  badge,
  actions,
}: {
  Icon: LucideIcon
  title: string
  badge?: string
  actions?: ReactNode
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-border-soft px-3"
      style={{ height: CARD_TITLE_PX }}
    >
      <Icon aria-hidden className="size-3.5 shrink-0 text-text-faint" />
      <span className="min-w-0 flex-1 truncate text-2xs font-medium text-text-soft">{title}</span>
      {badge && (
        <span className="shrink-0 rounded-sm bg-foreground/[0.06] px-1.5 font-mono text-3xs text-text-faint">
          {badge}
        </span>
      )}
      {actions && <div className="nodrag flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  )
}
