import { cn } from '@localixai/plugin-sdk/ui/classes'
import { MetadataTooltip } from '../overlays/tooltip'

/**
 * A small round status indicator. Color is supplied via `className` (e.g. a
 * `bg-status-*` token or a `STATUS_TONE_DOT` class) so the dot stays palette-
 * agnostic. One primitive so the size tokens stay consistent everywhere a
 * status pip appears (board columns, activity counts, runtime rows…).
 *
 * Decorative by default (`aria-hidden`). Pass `label` when the dot itself
 * conveys state with no adjacent text (e.g. an unread indicator) — it then gets
 * `role="status"` + the label as both accessible name and managed tooltip.
 */
export function StatusDot({
  size = 'sm',
  className,
  label,
}: {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  label?: string
}) {
  const dot = (
    <span
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
      className={cn(
        'inline-block shrink-0 rounded-full',
        size === 'lg' ? 'size-2.5' : size === 'md' ? 'size-2' : 'size-1.5',
        className,
      )}
    />
  )

  return label ? <MetadataTooltip label={label}>{dot}</MetadataTooltip> : dot
}
