import { cn } from '@localixai/plugin-sdk/ui/classes'

/**
 * A small bordered toggle pill — the multi/single-select filter chip used in the
 * board filter panels, dependency picker, etc. Active = info-tinted by
 * default; pass `activeClassName` for a different active treatment (e.g. a
 * neutral "Off" state). One primitive so toggle chips stay consistent.
 */
export function TogglePill({
  active,
  onClick,
  className,
  activeClassName,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  className?: string
  activeClassName?: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-2xs outline-none focus-ring transition-[color,background-color,border-color,transform] active:scale-[0.97] motion-reduce:active:scale-100',
        active
          ? (activeClassName ?? 'border-status-info/50 bg-status-info/12 text-status-info')
          : // Foreground veil, not `bg-surface-raised`: the raised token mixes from a darker
            // ground than the pane, so a row of these read as black chips. The veil takes the
            // pane's own colour and only adds density, like every other resting control fill.
            'border-control-border/55 bg-field-fill text-text-soft hover:border-control-border-hover hover:bg-surface-hover hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}
