import * as React from 'react'
import { cn, CONTROL_FOCUS_WITHIN } from '@localixai/plugin-sdk/ui/classes'
import { FLOATING_SURFACE } from '../layout/workbench-toolbar'

type FindWidgetSurfaceProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'aria-label'> & {
  /** Names the search scope, for example “Find in terminal”. */
  'aria-label': string
}

/**
 * Shared floating shell for scoped find experiences (chat, terminal, preview…).
 * Consumers own search state; this primitive owns the stable editor-widget
 * material, responsive width, elevation, and landmark semantics.
 */
const FindWidgetSurface = React.forwardRef<HTMLDivElement, FindWidgetSurfaceProps>(
  ({ className, 'aria-label': ariaLabel, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="find-widget"
      role="search"
      aria-label={ariaLabel}
      className={cn(
        'absolute right-3 top-2 z-(--z-sticky) flex max-w-[calc(100%-1rem)] items-center gap-1 p-1',
        FLOATING_SURFACE,
        CONTROL_FOCUS_WITHIN,
        className,
      )}
      {...props}
    />
  ),
)
FindWidgetSurface.displayName = 'FindWidgetSurface'

type FindWidgetInputProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'size'> & {
  'aria-label': string
}

/** Input geometry shared by floating find widgets; behavior remains consumer-owned. */
const FindWidgetInput = React.forwardRef<HTMLInputElement, FindWidgetInputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      data-slot="find-widget-input"
      type={type}
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="none"
      className={cn(
        'h-[var(--chrome-control-sm)] w-40 min-w-16 flex-1 bg-transparent px-1 text-xs text-foreground outline-none placeholder:text-text-faint',
        className,
      )}
      {...props}
    />
  ),
)
FindWidgetInput.displayName = 'FindWidgetInput'

interface FindWidgetCountProps extends Omit<React.ComponentPropsWithoutRef<'output'>, 'children'> {
  query: string
  /** Total matches in the current search scope. */
  count: number
  /** Zero-based active match index. */
  index: number
}

/** Compact visual count with a polite, complete screen-reader announcement. */
function FindWidgetCount({ query, count, index, className, ...props }: FindWidgetCountProps) {
  const hasQuery = query.trim().length > 0
  const safeCount = Math.max(0, count)
  const current = safeCount > 0 ? Math.min(Math.max(index, 0), safeCount - 1) + 1 : 0
  const state = !hasQuery ? 'empty' : safeCount > 0 ? 'matches' : 'no-results'
  const visual = state === 'empty' ? '' : state === 'matches' ? `${current}/${safeCount}` : '0/0'
  const announcement =
    state === 'empty'
      ? 'No search query'
      : state === 'matches'
        ? `${current} of ${safeCount} matches`
        : 'No matches'

  return (
    <output
      data-slot="find-widget-count"
      data-state={state}
      aria-live="polite"
      aria-atomic="true"
      aria-label={announcement}
      className={cn(
        'flex w-12 min-w-8 shrink items-center justify-center text-center text-2xs tabular-nums text-text-faint data-[state=no-results]:text-status-error',
        className,
      )}
      {...props}
    >
      {visual}
    </output>
  )
}

export { FindWidgetCount, FindWidgetInput, FindWidgetSurface }
export type { FindWidgetCountProps, FindWidgetInputProps, FindWidgetSurfaceProps }
