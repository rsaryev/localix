import type { ComponentProps, ReactNode } from 'react'
import type { StatusItemState } from '@localixai/plugin-sdk/ui'
import { cn } from '@localixai/plugin-sdk/ui/classes'

import { ComposerChip, COMPOSER_CHIP } from '@localixai/kit/composer-chip'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { statusItemMenuEntries } from '@/shared/ui/status-item-menu'
import { StatusItemBody } from '@localixai/kit/workbench-statusbar'
import { chromeAction, chromeActionActive } from '@localixai/kit/chrome-action'
import { Tooltip, TooltipContent, TooltipTrigger } from '@localixai/kit/tooltip'
import { useChordHint } from '@localixai/kit/keybindings'
import { WorkbenchStatusButton, WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'

/**
 * The one control every contributed status item becomes.
 *
 * A plugin describes what it has; this decides what that looks like. The seam it replaced handed
 * plugins a React surface, and the contributed button promptly grew its own height, its own hover
 * and no focus ring while sitting between two host buttons that had all three. Owning the render
 * is what makes that impossible rather than merely discouraged.
 *
 * All three placements are here on purpose. They differ only in their recipe — `chromeAction` in
 * the titlebar, `ComposerChip` above the input, `WorkbenchStatusButton` in the status bar — and
 * splitting them into three files would be the first step towards three behaviours.
 *
 * TWO uniformities the host owns and a plugin cannot opt out of:
 *   - a RIGHT-CLICK always opens a menu (see {@link statusItemMenuEntries}), even on an item whose
 *     author declared none. An icon that answers nothing is indistinguishable from a broken one;
 *   - `compact` drops the live text to the tooltip, so a narrow bar shows MORE plugins rather than
 *     fewer. The strip decides that once, for every item at once — see `status-strip-fit.ts`.
 */
export function StatusItemControl({
  state,
  placement,
  compact = false,
}: {
  state: StatusItemState
  placement: string
  /** Icon-only: the live text and metrics move into the tooltip and the accessible name. */
  compact?: boolean
}) {
  const hint = useChordHint()
  const { label, chordId, menu, onClick } = state
  // With no primary action but a DECLARED menu, the left click opens the menu — the behaviour of
  // every other icon in this chrome that has only one thing to offer. Read from the plugin's own
  // `menu`, never from the host-augmented entries: the uniform right-click menu must not turn a
  // display-only item into a button.
  const opensMenuOnClick = !onClick && Boolean(menu?.length)

  // What compaction takes off the bar, phrased once for the tooltip and the accessible name so a
  // glyph never becomes the only thing a screen reader is given.
  const detail = compact ? hiddenDetail(state) : ''
  const accessibleLabel = detail ? `${label} — ${detail}` : label

  const body = <StatusItemBody state={state} placement={placement} compact={compact} />
  const interactive = Boolean(onClick) || opensMenuOnClick

  const control = interactive ? (
    <StatusItemButton
      placement={placement}
      label={accessibleLabel}
      active={state.active}
      // No handler when the menu owns the click: `DropdownMenuTrigger` already toggles on click,
      // and adding our own toggle on top cancelled it out — the menu opened and shut in one press.
      onClick={opensMenuOnClick ? undefined : onClick}
    >
      {body}
    </StatusItemButton>
  ) : (
    <StatusItemStatic placement={placement} label={accessibleLabel}>
      {body}
    </StatusItemStatic>
  )

  const entries = statusItemMenuEntries(state)

  /**
   * ONE element under every trigger, and the nesting order is load-bearing. It used to be wrong:
   * the context-menu trigger wrapped `<Tooltip>` — a Radix ROOT, a component with no element and
   * no prop forwarding — so everything `asChild` handed it, the `onContextMenu` that opens the
   * menu included, was dropped on the floor and right-click did nothing on any contributed item.
   * Roots go OUTSIDE, triggers compose inwards, the control is the node they all land on.
   */
  const trigger = <TooltipTrigger asChild>{control}</TooltipTrigger>

  return (
    <Tooltip>
      <ContextMenu>
        {opensMenuOnClick ? (
          <DropdownMenu>
            <ContextMenuTrigger asChild>
              <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
            </ContextMenuTrigger>
            <DropdownMenuContent align="end">
              <MenuEntries entries={entries} family="dropdown" />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
        )}
        {/* Right-click opens the same entries, whatever the left click does. */}
        <ContextMenuContent>
          <MenuEntries entries={entries} family="context" />
        </ContextMenuContent>
      </ContextMenu>
      <TooltipContent side={placement === 'titlebar' ? 'bottom' : 'top'}>
        {hint(label, chordId)}
        {detail ? <span className="mt-0.5 block text-2xs text-text-faint">{detail}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The live detail a compact item no longer draws — its text and what its metrics MEAN.
 *
 * The metric's `label`, not its value: that is the phrasing its author wrote for assistive
 * technology ("2 commits ahead"), where "2 · 1" would be the value without the fact.
 */
function hiddenDetail(state: StatusItemState): string {
  return [state.text, ...(state.metrics ?? []).map((metric) => metric.label)]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
}

/**
 * The button, with whatever its triggers put on it. `...trigger` is not decoration: an `asChild`
 * Radix trigger merges its props (and ref) onto the element BELOW it, and a component that forgets
 * to forward them swallows the menu handlers silently — how right-click came to do nothing here.
 */
function StatusItemButton({
  placement,
  label,
  active,
  onClick,
  children,
  ...trigger
}: {
  placement: string
  label: string
  active?: boolean
  onClick?: () => void
  children: ReactNode
} & Omit<ComponentProps<'button'>, 'onClick' | 'children'>) {
  // No `type` in here on purpose: a native `<button>` must DECLARE its form behaviour where a
  // reader (and `button.contract.test.ts`) can see it, and a spread hides that. The two primitives
  // below default it themselves.
  const shared = {
    ...trigger,
    'aria-label': label,
    'aria-pressed': active ?? undefined,
    onClick,
  }
  if (placement === 'composer') {
    // The composer row's own primitive, which owns the glass material AND the geometry. A pill
    // that composed only the class string lost its height and padding — that is how the git chips
    // ended up flat and padless next to the project chip.
    return (
      <ComposerChip {...shared} tone={active ? 'strong' : 'default'}>
        {children}
      </ComposerChip>
    )
  }
  if (placement === 'statusbar') {
    return (
      <WorkbenchStatusButton {...shared} className="gap-1.5">
        {children}
      </WorkbenchStatusButton>
    )
  }
  return (
    <button type="button" {...shared} className={cn(chromeAction, active && chromeActionActive)}>
      {children}
    </button>
  )
}

/** A readout rather than a control — and still the node its triggers attach to. */
function StatusItemStatic({
  placement,
  label,
  children,
  ...trigger
}: {
  placement: string
  label: string
  children: ReactNode
} & Omit<ComponentProps<'span'>, 'children'>) {
  if (placement === 'statusbar') {
    return (
      <WorkbenchStatusItem {...trigger} aria-label={label} className="gap-1.5">
        {children}
      </WorkbenchStatusItem>
    )
  }
  if (placement === 'composer') {
    return (
      <span
        {...trigger}
        aria-label={label}
        className={cn(COMPOSER_CHIP, 'h-[var(--chrome-control-md)] px-2.5')}
      >
        {children}
      </span>
    )
  }
  // `pointer-events-none` would also swallow the right-click this readout still answers, so the
  // inert look comes from `cursor-default` alone.
  return (
    <span {...trigger} aria-label={label} className={cn(chromeAction, 'cursor-default')}>
      {children}
    </span>
  )
}
