import type { ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ActivityOrb, ActivitySignal, cleanActivityLabel } from './activity-orb'

/**
 * Quiet, borderless "nothing here yet" hint used by the settings panels
 * (plugins, MCP, skills, providers…) and list-shaped panels. One source of
 * truth for the empty-list styling so the panels stay consistent — muted text,
 * no frame/card, centered on BOTH axes when the parent gives it height
 * (`h-full` collapses to content height in plain flow, so list contexts are
 * unchanged). Accepts rich children (e.g. inline <code>) — the inner span
 * keeps them on one inline line under the flex centering.
 */
export function EmptyHint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'flex h-full select-none items-center justify-center p-6 text-sm text-text-faint',
        className,
      )}
    >
      <span className="text-center">{children}</span>
    </p>
  )
}

/**
 * Delayed reveal for the loading line. A fast open (cached tab body, warm
 * session, an already-resolved lazy chunk) resolves well inside this window, so
 * the hint never paints at all and the user sees content instead of a flash of
 * "Loading…". A progress indicator is started with an explicit delay rather
 * than shown immediately, for the same reason.
 *
 * CSS-only on purpose: a timer would cost a state update and a second render per
 * mount on the very path we are trying to keep cheap. `fill-mode: both` is what
 * holds the element at `opacity: 0` for the whole delay — without it the element
 * paints at its natural opacity until the animation starts, which is the flash.
 * Reduced motion is handled by the global kill in `index.css` (it forces
 * `animation-delay: 0s` + a 0.01ms duration), so the hint appears immediately.
 */
const LOADING_HINT_REVEAL =
  'animate-in fade-in duration-(--dur-base) [animation-delay:300ms] [animation-fill-mode:both]'

/**
 * Inline "loading…" line for a panel while its content is being fetched.
 * Pairs with EmptyHint as the two transient list states and shares its
 * both-axes centering, so a fill-height surface (order book, tab body)
 * shows the text dead-center instead of top-left.
 */
export function LoadingHint({
  children = 'Loading…',
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  const textLabel = typeof children === 'string' ? cleanActivityLabel(children) : null

  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        'flex h-full select-none items-center justify-center p-4 text-sm text-text-faint',
        LOADING_HINT_REVEAL,
        className,
      )}
    >
      {textLabel ? (
        <ActivitySignal
          label={textLabel}
          className="justify-center font-medium"
          labelClassName="min-w-0"
        />
      ) : (
        <span className="inline-flex items-center justify-center gap-1.5 text-center">
          <ActivityOrb className="text-composer-accent" />
          <span>{children}</span>
        </span>
      )}
    </p>
  )
}
