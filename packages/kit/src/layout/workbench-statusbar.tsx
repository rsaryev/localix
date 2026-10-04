import type { ComponentProps } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'

type WorkbenchStatusBarProps = Omit<ComponentProps<'div'>, 'aria-label' | 'role'> & {
  /** Names the status item group without turning updates into a live region. */
  'aria-label': string
  align?: 'start' | 'end'
  divided?: boolean
  /** Which edge owns the structural seam when the row sits above or below content. */
  seam?: 'top' | 'bottom'
  /** Structural seam token for content panels or sidebar/rail chrome. */
  tone?: 'content' | 'sidebar'
  /**
   * Let a summary set keep every segment when the pane is too narrow for one row,
   * the same opt-in `WorkbenchToolbar` already offers, with the same shape: the
   * density's measure becomes a MINIMUM instead of a fixed height.
   *
   * The default stays a single clipped row — that is the right answer for a real
   * status bar, where the segments are ranked and the tail is expendable. It is the
   * wrong answer for a SUMMARY of independent metrics (the Vault's item/consumer
   * counts), where clipping silently drops half the numbers in a side panel.
   *
   * `divided` draws between siblings on one axis, so the two do not combine; a
   * wrapped bar separates its segments by spacing.
   */
  wrap?: boolean
}

/**
 * Stable, overflow-clipped workbench status/summary row. Status changes are deliberately
 * not announced as a live region: individual interactive items expose their own
 * names and users can reach them through the ordinary Tab order.
 */
export function WorkbenchStatusBar({
  className,
  align = 'start',
  divided = false,
  seam = 'top',
  tone = 'content',
  wrap = false,
  'aria-label': ariaLabel,
  ...props
}: WorkbenchStatusBarProps) {
  return (
    <div
      data-slot="workbench-statusbar"
      data-seam={seam}
      data-wrap={wrap || undefined}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'flex shrink-0 items-stretch text-2xs text-text-faint',
        wrap
          ? 'min-h-[var(--statusbar-height)] flex-wrap gap-y-0.5 py-1'
          : 'h-[var(--statusbar-height)] overflow-hidden',
        seam === 'top' ? 'border-t' : 'border-b',
        tone === 'sidebar' ? 'border-sidebar-border' : 'border-border-soft',
        align === 'end' && 'justify-end',
        divided &&
          (tone === 'sidebar' ? 'divide-x divide-sidebar-border' : 'divide-x divide-border-soft'),
        className,
      )}
      {...props}
    />
  )
}

/**
 * Read-only status segment with the same geometry as an interactive item.
 *
 * The width cap is `max-w-full`, not a viewport fraction: a status bar lives in a
 * PANE, and `40vw` meant one segment could claim more than the whole sidebar it
 * sat in, or barely a third of a maximized editor. The bar itself already clips
 * (`overflow-hidden`), so the segment only has to agree to truncate.
 */
export function WorkbenchStatusItem({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="workbench-status-item"
      className={cn(
        // `min-h-full`, not `h-full`: on a WRAPPED bar the row's height comes from its
        // content, and a percentage height against an auto-height flex line resolves to
        // the line box — which collapsed the segments onto each other.
        'flex min-h-full min-w-0 max-w-full items-center overflow-hidden px-2 leading-none whitespace-nowrap text-ellipsis',
        className,
      )}
      {...props}
    />
  )
}

/** Interactive status segment: full-height hit target, hover and keyboard focus. */
export function WorkbenchStatusButton({
  className,
  type = 'button',
  ...props
}: ComponentProps<'button'>) {
  return (
    <button
      data-slot="workbench-status-button"
      type={type}
      className={cn(
        'flex h-full min-w-0 max-w-full items-center overflow-hidden px-2 text-2xs leading-none whitespace-nowrap text-text-faint text-ellipsis outline-none transition-colors hover:bg-surface-hover hover:text-text-soft focus-ring disabled:cursor-default disabled:hover:bg-transparent',
        className,
      )}
      {...props}
    />
  )
}

export type { WorkbenchStatusBarProps }
