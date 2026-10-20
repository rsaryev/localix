import type { CSSProperties, ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'

import { POPOVER_SURFACE } from '../overlays/popover-surface'

/**
 * The three pieces every game board shares, so the boards line up with each other and nothing on
 * them moves when the game's state changes.
 *
 * Each game used to build its own: a status block that grew with the state (a reason, an error, a
 * recovery button) inside a row that wrapped its controls below once the text got long. The pane
 * centres the board vertically, so every one of those changes moved the board itself. Now the row
 * has one height, the status two fixed lines, and whatever stopped the game floats over the top of
 * the board as a {@link GameProblem} instead of pushing it down.
 */

/**
 * The row above a game's board: the state on the left, the controls on the right. The controls never
 * wrap under the status — the status gives way and truncates. Only a pane too narrow for both stacks
 * them, which depends on the pane, never on the game.
 */
export function GameControlRow({
  status,
  controls,
  className,
  style,
}: {
  status: ReactNode
  controls?: ReactNode
  className?: string
  /** The board's width, so the row's ends line up with the board's edges. */
  style?: CSSProperties
}) {
  return (
    <div data-slot="game-control-row" className={cn('@container w-full', className)} style={style}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 @max-sm:grid-cols-1">
        <div className="min-w-0">{status}</div>
        {controls && <div className="flex shrink-0 items-center gap-1">{controls}</div>}
      </div>
    </div>
  )
}

/**
 * The game's state in two lines of fixed height: what it waits for, and the score or side beneath.
 * A long headline truncates (its full text stays in the tooltip); a problem is never written here —
 * it is a {@link GameProblem}.
 */
export function GameStatus({
  icon,
  title,
  suffix,
  detail,
  tone = 'default',
}: {
  /** A small glyph before the headline: the side to move, a thinking orb. Decorative. */
  icon?: ReactNode
  title: string
  /** Kept whole beside the headline: a clock, "· check". */
  suffix?: ReactNode
  detail?: ReactNode
  tone?: 'default' | 'success'
}) {
  return (
    <div data-slot="game-status" className="flex h-11 min-w-0 flex-col justify-center gap-0.5">
      <p className="flex min-w-0 items-center gap-2 text-base leading-6 font-medium">
        {icon && (
          <span aria-hidden className="flex shrink-0">
            {icon}
          </span>
        )}
        <span
          title={title}
          className={cn('truncate', tone === 'success' ? 'text-status-success' : 'text-foreground')}
        >
          {title}
        </span>
        {suffix && (
          <span className="shrink-0 text-sm font-normal tabular-nums text-text-faint">
            {suffix}
          </span>
        )}
      </p>
      {detail && (
        <p className="truncate text-xs leading-4 tabular-nums text-text-faint">{detail}</p>
      )}
    </div>
  )
}

/**
 * What stopped the game and the way out, floating over the top of the board so the board stays
 * where it is: a failed request, an opponent that could not be reached, a move that is taking too
 * long. Render it inside the board's `relative` wrapper. The text wraps in full here, and the
 * actions say what to do about it — retry, ask again, or play someone else.
 *
 * `role` is the caller's: `alert` for a failure, `status` for a wait that is only slow.
 */
export function GameProblem({
  title,
  description,
  actions,
  role = 'alert',
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  role?: 'alert' | 'status'
}) {
  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-(--z-raised) flex justify-center">
      <div
        role={role}
        data-slot="game-problem"
        className={cn(
          POPOVER_SURFACE,
          'pointer-events-auto grid w-full max-w-md grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-2.5 px-3.5 py-3',
          'animate-in fade-in-0 duration-(--dur-fast) motion-reduce:animate-none',
        )}
      >
        <CircleAlert aria-hidden className="mt-0.5 size-4 text-status-warning" />
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm leading-5 font-medium text-foreground">{title}</p>
          {description && (
            <p className="text-xs leading-5 text-pretty text-text-soft">{description}</p>
          )}
        </div>
        {actions && <div className="col-start-2 flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
