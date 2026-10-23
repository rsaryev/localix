import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from './button'
import { ActionTooltip } from '../overlays/action-tooltip'

/**
 * The subtle square icon action used throughout workbench and mini app chrome.
 * Geometry delegates to Button's semantic control scale, so a toolbar action
 * stays stable regardless of the icon component rendered inside it.
 */
const APPEARANCE = {
  content: {
    default:
      'text-text-faint hover:bg-surface-hover hover:text-foreground aria-expanded:bg-surface-active aria-expanded:text-foreground aria-pressed:bg-surface-active aria-pressed:text-foreground',
    danger:
      'text-text-faint hover:bg-surface-hover hover:text-status-error aria-expanded:bg-status-error/10 aria-expanded:text-status-error aria-pressed:bg-status-error/10 aria-pressed:text-status-error',
  },
  sidebar: {
    default:
      'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-foreground aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-foreground',
    danger:
      'text-destructive hover:bg-destructive/15 hover:text-destructive aria-expanded:bg-destructive/15 aria-pressed:bg-destructive/15',
  },
} as const

/**
 * One name, one measure — the SAME measure `Button` gives that name.
 *
 * This map used to sit one tier tighter than its labels (`sm`→20, `md`→24,
 * `lg`→28), so equal heights in a shared row required UNEQUAL prop words. An
 * audit of every row in the repo where a Button and an IconButton are siblings
 * found 11 such rows, none of which used the same word on both — and 7 of the
 * 11 still landed 4–8px apart, because authors were guessing at an offset
 * nothing documented. `resource-context-button.tsx` was the proof: one
 * component whose two interchangeable modes both asked for `size="sm"` and
 * rendered 24px and 20px.
 *
 * So the names were re-tiered onto Button's ladder. `xs` was added to keep the
 * 20px control reachable (it is a real size — dense toolbars use it), and `xl`
 * now resolves to the 36px square added to `buttonVariants` for the purpose.
 * Every call site was rewritten in the same change to keep its rendered pixels,
 * so this was a rename, not a resize.
 */
const BUTTON_SIZE = {
  /** Dense toolbars and inline row affordances; pairs with Button `xs`. */
  xs: 'icon-xs',
  sm: 'icon-sm',
  md: 'icon',
  lg: 'icon-lg',
  /** Composer and primary pane actions use the full 36px control measure. */
  xl: 'icon-xl',
  /** Navigation and mobile chrome keep a stable 40px pointer/touch target. */
  touch: 'icon-touch',
} as const

const BUTTON_VARIANT = {
  subtle: 'ghost',
  solid: 'mono',
} as const

type IconButtonProps = Omit<
  ComponentPropsWithoutRef<typeof Button>,
  'aria-label' | 'children' | 'size' | 'title' | 'variant'
> & {
  /** Icon-only controls always need a stable accessible name. */
  'aria-label': string
  children: ReactNode
  tone?: keyof (typeof APPEARANCE)['content']
  /** `solid` is the primary icon-action treatment (send, stop, confirm). */
  emphasis?: keyof typeof BUTTON_VARIANT
  /** Adapts idle, hover, expanded and pressed colors to the host chrome. */
  surface?: keyof typeof APPEARANCE
  /**
   * Same ladder as `Button`, and the same default (`md` = 28px), so a bare
   * `<IconButton>` lines up with a bare `<Button>` beside it. The default was
   * `md` = 24px while `Button`'s was 28px, which is why an unadorned pair sat
   * 4px apart; every call site relying on that 24px was given an explicit
   * `size="sm"` when this changed.
   */
  size?: keyof typeof BUTTON_SIZE
  /** Styled tooltip label; native `title` is intentionally not part of this API. */
  tooltip?: ReactNode
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right'
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      className,
      type = 'button',
      tone = 'default',
      emphasis = 'subtle',
      surface = 'content',
      size = 'md',
      tooltip,
      tooltipSide,
      disabled,
      children,
      'aria-label': ariaLabel,
      ...props
    },
    ref,
  ) => {
    const button = (
      <Button
        ref={ref}
        aria-label={ariaLabel}
        type={type}
        variant={BUTTON_VARIANT[emphasis]}
        size={BUTTON_SIZE[size]}
        data-surface={surface}
        data-emphasis={emphasis}
        disabled={disabled}
        className={cn(emphasis === 'subtle' && APPEARANCE[surface][tone], className)}
        {...props}
      >
        <span aria-hidden="true" className="contents">
          {children}
        </span>
      </Button>
    )
    if (tooltip == null) return button
    return (
      <ActionTooltip
        label={tooltip}
        side={tooltipSide}
        disabled={disabled}
        accessibleLabel={ariaLabel}
      >
        {button}
      </ActionTooltip>
    )
  },
)
IconButton.displayName = 'IconButton'

export { IconButton }
export type { IconButtonProps }
