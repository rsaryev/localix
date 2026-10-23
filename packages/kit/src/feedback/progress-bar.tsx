import { clamp, cn } from '@localixai/mini-app-sdk/ui/classes'

/**
 * Slim progress/completion bar — a rounded track with a filled portion. Used for
 * checklist completion, stats meters, etc. `value` is a 0–100 percent
 * (clamped). Track size comes from `className`; fill color/animation overridable
 * via `fillClassName`. Pass `aria-*` for accessible value reporting.
 */
export function ProgressBar({
  value,
  className,
  fillClassName,
  ...aria
}: {
  value: number
  className?: string
  fillClassName?: string
} & React.AriaAttributes) {
  const pct = clamp(value, 0, 100)
  return (
    <div
      role="progressbar"
      className={cn('overflow-hidden rounded-full bg-foreground/10', className)}
      {...aria}
    >
      <div
        className={cn(
          'h-full rounded-full bg-status-success transition-[width] duration-(--dur-slow)',
          fillClassName,
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
