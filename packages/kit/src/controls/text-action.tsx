import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { ActionTooltip } from '../overlays/action-tooltip'

type TextActionProps = Omit<ComponentPropsWithoutRef<'button'>, 'title'> & {
  /** Styled explanation or full untruncated target; native title is excluded. */
  tooltip?: ReactNode
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right'
}

/**
 * Native text-shaped command target for paths and other IDE resources.
 *
 * Unlike Button's bounded control geometry, this primitive inherits the host's
 * font and line-height so it can participate in prose, console output, and
 * truncating rows without changing their metrics. It still owns one keyboard
 * focus treatment and the same managed tooltip contract as icon actions.
 */
const TextAction = forwardRef<HTMLButtonElement, TextActionProps>(
  (
    {
      className,
      type = 'button',
      tooltip,
      tooltipSide,
      disabled,
      children,
      'aria-label': ariaLabel,
      ...props
    },
    ref,
  ) => {
    const action = (
      <button
        ref={ref}
        type={type}
        data-slot="text-action"
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          'inline min-w-0 cursor-pointer appearance-none rounded-sm border-0 bg-transparent p-0 text-left font-[inherit] text-[inherit] leading-[inherit] outline-none transition-colors duration-(--dur-fast) focus-ring disabled:pointer-events-none disabled:cursor-default disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </button>
    )

    if (tooltip == null) return action
    const accessibleLabel =
      typeof ariaLabel === 'string' ? ariaLabel : typeof tooltip === 'string' ? tooltip : undefined
    return (
      <ActionTooltip
        label={tooltip}
        side={tooltipSide}
        disabled={disabled}
        accessibleLabel={accessibleLabel}
      >
        {action}
      </ActionTooltip>
    )
  },
)
TextAction.displayName = 'TextAction'

export { TextAction }
export type { TextActionProps }
