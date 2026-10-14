import type { StatusItemState, StatusMetric } from '@localixai/plugin-sdk/ui'
import { cn } from '@localixai/plugin-sdk/ui/classes'

import { Chip } from '../feedback/chip'
import { Spinner } from '../feedback/spinner'
import { StatusDot } from '../feedback/status-dot'
import {
  STATUS_BADGE_CLASS,
  STATUS_DOT_CLASS,
  STATUS_TEXT_CLASS,
  tonedClass,
} from '../feedback/status-tone'

/**
 * What a contributed status item LOOKS like, separated from where it can be clicked.
 *
 * {@link StatusItemControl} is about wiring — which primitive a placement uses, which triggers
 * compose onto the control, what a right-click opens. This file is about the row inside it. They
 * were one file and it was drifting past the repo's size ratchet, but the reason to split here is
 * not the line count: the two halves change for different reasons, and every bug either half has
 * had was about the OTHER one's concern leaking in.
 */

/**
 * Glyph, live text, metrics, then the badge — the same reading order in every placement.
 *
 * `compact` keeps the two parts that stay legible at a 28px pitch: the glyph (the item's identity)
 * and the badge (the reason to look at it). The rest is on the tooltip and in the accessible name,
 * so compaction costs a hover, never a fact.
 */
export function StatusItemBody({
  state,
  placement,
  compact = false,
}: {
  state: StatusItemState
  placement: string
  compact?: boolean
}) {
  const { Icon, text, metrics, badge, busy, tone } = state
  const iconSize = placement === 'statusbar' ? 'size-3' : 'size-3.5'
  // The titlebar is the one placement whose control carries no font size of its own, so anything
  // unsized in here inherits the chrome's base — which is how `main` sat at 10px beside an `↑23`
  // at 14px. The size belongs to the ROW, not to the text alone: a metric is read as part of the
  // same phrase and has to match it.
  const textSize = placement === 'titlebar' ? 'text-2xs' : ''
  const textClass = cn(textSize, 'font-medium')
  // Compact items sit at a fixed pitch, so their signal is pinned to the control's corner rather
  // than added to its row: inline, a count ticking from 9 to 10 widens the button and shoves every
  // glyph beside it — the exact jitter a stable strip exists to remove. The event bell's counter
  // is pinned for the same reason, and the ring is what cuts it away from the glyph it overlaps.
  const corner = compact ? 'pointer-events-none absolute -top-px -right-px ring-2 ring-sidebar' : ''
  return (
    <>
      {/* Busy replaces the GLYPH when compact — there is no room beside it for a second one. */}
      {busy && compact ? (
        <Spinner className={cn(iconSize, 'shrink-0')} />
      ) : Icon ? (
        <Icon className={cn(iconSize, 'shrink-0', tonedClass(STATUS_TEXT_CLASS, tone))} />
      ) : null}
      {!compact && text && <span className={cn('max-w-32 truncate', textClass)}>{text}</span>}
      {!compact &&
        metrics?.map((metric, index) => (
          <StatusMetricView key={`${metric.label}:${index}`} metric={metric} className={textSize} />
        ))}
      {busy && !compact ? (
        <Spinner className="size-3 shrink-0" />
      ) : busy ? null : badge && 'count' in badge ? (
        <Chip
          aria-live="polite"
          tone="accent"
          size="counter"
          className={cn('font-semibold leading-none', corner, tonedClass(STATUS_BADGE_CLASS, tone))}
        >
          {badge.count > 99 ? '99+' : badge.count}
        </Chip>
      ) : badge ? (
        <StatusDot className={cn(corner, tonedClass(STATUS_DOT_CLASS, tone) ?? 'bg-text-faint')} />
      ) : null}
    </>
  )
}

/**
 * A glyph-and-number pair.
 *
 * `tabular-nums` is the whole reason this is not part of `text`: a counter that changes width as
 * it counts makes the controls beside it move, and a live indicator that shifts its neighbours is
 * worse than no indicator.
 */
function StatusMetricView({ metric, className }: { metric: StatusMetric; className?: string }) {
  const { icon: Icon, value, label, tone } = metric
  return (
    <span
      title={label}
      className={cn(
        'flex shrink-0 items-center gap-0.5 tabular-nums',
        className,
        tonedClass(STATUS_TEXT_CLASS, tone) ?? 'text-text-faint',
      )}
    >
      {Icon && <Icon className="size-2.5 shrink-0" />}
      {value}
    </span>
  )
}
