import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from './button'
import { FLOATING_SURFACE } from '../layout/workbench-toolbar'

/**
 * The small action pill pinned over a scrolling viewer surface (file viewer
 * header, image zoom bar, the review-comments trigger).
 *
 * NO resting fill, border or blur. It used to carry `bg-surface-raised/85` plus a hairline plus
 * its own `backdrop-blur` — and it almost always sits inside a `FloatingActionGroup`, which paints
 * that same material for the whole row. Two coats of one token composite to ~0.985, so every label
 * read as a separate black chip inside a black tray, each with its own edge, and the blurs nested.
 * The GROUP owns the material; the pills are transparent and only light up under the pointer,
 * which is how `IconButton` (ghost) and `chromeAction` already behave inside chrome.
 *
 * The hover fill is `--popover-hover`, not `--surface-hover`: it lands on the group's `--popover`
 * ground, and those two hover tiers are tuned against different grounds.
 *
 * `elevated` is the opt-in for the few pills that float ALONE, with no group behind them (the
 * visual-feedback comment pill over a live preview). It composes the exact same `FLOATING_SURFACE`
 * string the group uses, so a lone pill and a row of pills are cut from one material rather than
 * two lookalikes. A pill sitting in real chrome — a `PanelHeader`'s actions slot, say — wants the
 * default: the chrome already has a ground.
 *
 * `active` drives the LABEL only — an idle pill reads faint, an engaged one at
 * full foreground; the hover fill is the same either way. Lives in shared/ui
 * because `comments/CommentsManager` needs it too and cannot import upward from
 * `features/` — that FSD wall is why the class string got transcribed six times.
 *
 * Everything else passes through as native button props, so it can also be the
 * `asChild` target of a Radix trigger.
 */
type ActionPillProps = Omit<ComponentPropsWithoutRef<typeof Button>, 'size' | 'variant'> & {
  /** Visual emphasis only; callers own pressed/expanded semantics. */
  active?: boolean
  /** Carry the floating material itself, for a pill with no `FloatingActionGroup` behind it. */
  elevated?: boolean
}

const ActionPill = forwardRef<HTMLButtonElement, ActionPillProps>(
  ({ className, type = 'button', active, elevated, ...props }, ref) => (
    <Button
      ref={ref}
      type={type}
      variant="ghost"
      size="xs"
      data-active={active || undefined}
      className={cn(
        'px-1.5 text-2xs hover:bg-popover-hover hover:text-foreground disabled:cursor-not-allowed',
        active ? 'text-foreground' : 'text-text-faint',
        // `rounded-md` last so the shared surface's corner does not fight the control scale: the
        // group is a 2px-padded tray, so its own `rounded-md` on a lone pill would read oversized.
        elevated && cn(FLOATING_SURFACE, 'rounded-md'),
        className,
      )}
      {...props}
    />
  ),
)
ActionPill.displayName = 'ActionPill'

export { ActionPill }
export type { ActionPillProps }
