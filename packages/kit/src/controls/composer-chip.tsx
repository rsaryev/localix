import * as React from 'react'
import { ChevronDown } from 'lucide-react'
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
 * The chip sits ON the window, in the composer's row, so it is an ink fill and not a surface
 * (docs/internals/visual-system.md, "Surfaces over the window"): it rests at `--field-fill` and
 * climbs the shared steps on hover, press and while its menu is open. No outline draws its shape —
 * an outlined pill read as a wireframe beside filled controls — and no raised material, which is
 * for things that float over content and must hide it. Tones speak through text colour alone.
 */
export const COMPOSER_CHIP =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-field-fill text-xs text-text-soft outline-none transition-colors focus-ring hover:bg-surface-hover hover:text-foreground active:bg-surface-active aria-expanded:bg-surface-active aria-expanded:text-foreground data-[state=open]:bg-surface-active data-[state=open]:text-foreground disabled:cursor-default disabled:bg-field-fill disabled:opacity-50'

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

/**
 * The chip's "opens a menu" mark. One spelling, so every chip in the row carries the same chevron:
 * they had three (12px at 60%, 14px in the faint ink, and 12px at full strength). A chip's leading
 * icon is `size-3.5`.
 */
export function ComposerChipChevron() {
  return <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden="true" />
}
