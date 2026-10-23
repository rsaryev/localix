import type { ComponentType, ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/**
 * The app's ONE minimal pattern for empty/error/state notices: centered,
 * borderless, quiet — an optional small muted icon, a short title, a dimmer
 * body line, and an optional compact action group. No frames, no
 * cards, no shadows.
 *
 * Use it for full-pane placeholders — empty panels, "nothing selected", a view
 * that has nothing to show yet. NOT for failures: a failure is reported by
 * `ProblemLine` (one line, with the report itself in the Event Center), because
 * a problem nobody can find again five seconds later is a problem nobody fixed.
 * A pane whose emptiness IS a failure composes the two: StateNotice as the shell
 * that centres and carries the recovery action, ProblemLine in its `body`.
 * Genuinely modal dialogs stay dialogs — this is for in-place states, not
 * interruptions.
 *
 * For ONE-LINE empties inside lists/trees/rows (an empty folder, "No matches",
 * a missing value) a full StateNotice is too heavy — use the inline convention
 * instead: a quiet `text-xs`/`text-2xs` `text-text-faint` line, sentence-case
 * copy, no parentheses, and NO italics (italic is reserved for reasoning,
 * ghost text, ephemeral tabs and quoted context).
 *
 * Placement: a PANE-LEVEL empty (the sole content of a panel/list area) must
 * center overall — vertically AND horizontally — in the available space.
 * StateNotice fills the available height in both block and flex parents, so
 * its content stays centered in a full-height pane. Inline-convention one-liners
 * used as a pane's only content get a
 * `flex h-full items-center justify-center` (or `flex-1 min-h-0`) wrapper.
 * Rows inside populated lists stay rows.
 */
export function StateNotice({
  icon: Icon,
  title,
  body,
  actions,
  actionsLabel = 'Available actions',
  className,
  bodyClassName,
  role,
  ariaLive,
}: {
  /** Small muted lucide icon shown above the title. */
  icon?: ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>
  title: ReactNode
  body?: ReactNode
  /** Caller-owned buttons or links; supports one or many recovery actions. */
  actions?: ReactNode
  /** Accessible name for the action group. */
  actionsLabel?: string
  className?: string
  /**
   * Widens or re-aligns the body slot. The default `max-w-xs` is right for a sentence and wrong for
   * a structured body (a problem list, a small table), which is the only reason this exists.
   */
  bodyClassName?: string
  /** Optional state semantics for recoverable failures and background recovery. */
  role?: 'alert' | 'status'
  ariaLive?: 'off' | 'polite' | 'assertive'
}) {
  return (
    <div
      role={role}
      aria-live={ariaLive}
      className={cn(
        'flex h-full min-h-0 flex-1 select-none flex-col items-center justify-center gap-1 px-6 py-8 text-center',
        className,
      )}
    >
      {Icon && <Icon className="mb-1 size-6 text-text-faint" strokeWidth={1.5} aria-hidden />}
      <div className="text-sm font-medium text-text-soft">{title}</div>
      {body != null && (
        <div className={cn('max-w-xs text-xs text-text-faint', bodyClassName)}>{body}</div>
      )}
      {actions != null && (
        <div
          role="group"
          aria-label={actionsLabel}
          className="mt-1.5 flex max-w-full flex-wrap items-center justify-center gap-1.5"
        >
          {actions}
        </div>
      )}
    </div>
  )
}
