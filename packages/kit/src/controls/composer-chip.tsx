import * as React from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

type ComposerChipProps = React.ComponentPropsWithoutRef<'button'> & {
  tone?: 'default' | 'strong' | 'danger'
}

/**
 * The chip recipe as a class string, for a caller that must put it on its OWN element (a label, an
 * anchor, a Radix trigger via `asChild`) rather than render `<ComposerChip>`. The component below
 * composes this same constant, so the two can never drift — which is the whole reason it is
 * exported instead of being copied by anyone who needs the classes without the button.
 *
 * The material is the scroll-to-latest pill's (`.lx-glass`: translucent fill and a flat rim).
 * These chips float over chat, so they retain backdrop blur while hover and press change only
 * the fill. `lx-glass-self` makes the chip its own trigger. The rim replaces a layout border,
 * so tones speak through text colour alone.
 */
export const COMPOSER_CHIP =
  'lx-glass lx-glass-self inline-flex cursor-pointer items-center gap-1.5 rounded-full text-xs text-text-soft outline-none transition-colors focus-ring hover:text-foreground disabled:cursor-default disabled:opacity-50'

/**
 * Native action/trigger for the composer's “where and how am I working?” row.
 * It owns geometry and state semantics; callers own their icon, label and action.
 */
export const ComposerChip = React.forwardRef<HTMLButtonElement, ComposerChipProps>(
  ({ className, tone = 'default', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      data-slot="composer-chip"
      data-tone={tone}
      type={type}
      className={cn(
        COMPOSER_CHIP,
        'h-[var(--chrome-control-md)] max-w-[14rem] px-2.5',
        tone === 'strong' && 'text-foreground',
        tone === 'danger' && 'text-status-error hover:text-status-error',
        className,
      )}
      {...props}
    />
  ),
)
ComposerChip.displayName = 'ComposerChip'
