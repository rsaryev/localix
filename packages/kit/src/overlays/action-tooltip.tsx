import type { ReactElement, ReactNode } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

type ActionTooltipProps = {
  /** A single control or composed Radix `asChild` trigger. */
  children: ReactElement
  label: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** Native disabled controls need an adjacent event/focus anchor. */
  disabled?: boolean
  /** Name announced for the focus anchor when `disabled` is true. */
  accessibleLabel?: string
  /** Controlled visibility for gestures that must dismiss the hint (for example drag). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * One styled action hint for direct controls and composed menu/popover triggers.
 * This keeps native `title` out of workbench chrome while preserving Radix
 * `asChild` ref/event composition.
 */
function ActionTooltip({
  children,
  label,
  side,
  disabled = false,
  accessibleLabel,
  open,
  onOpenChange,
}: ActionTooltipProps) {
  // Native disabled controls do not emit hover/focus events. A focusable,
  // geometry-neutral anchor keeps the explanation reachable without making
  // the action operable (disabled action labels/tooltips stay discoverable).
  const trigger = disabled ? (
    <span
      data-disabled-tooltip-anchor="true"
      tabIndex={0}
      aria-label={accessibleLabel}
      className="inline-flex min-w-0 max-w-full shrink-0 cursor-not-allowed"
    >
      {children}
    </span>
  ) : (
    children
  )
  return (
    <Tooltip open={open} onOpenChange={onOpenChange}>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent
        data-passive-tooltip
        side={side}
        // Action hints contain no controls. Under a transformed canvas a floating label can
        // overlap an adjacent action, so it must never intercept that action's pointer events.
        className="pointer-events-none max-w-[min(24rem,calc(100vw-2rem))] whitespace-normal break-words"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export { ActionTooltip }
export type { ActionTooltipProps }
