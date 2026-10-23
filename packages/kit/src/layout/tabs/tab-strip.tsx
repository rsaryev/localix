import { useEffect, useMemo, useRef } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { useHorizontalWheelScroll } from '../../lib/use-horizontal-wheel-scroll'
import { DROP_TARGET_INDICATOR_BEFORE_VERTICAL } from '../../lists/drop-target'
import { useTabOverflow } from './overflow'
import { useRevealActiveTab, type RevealPadding } from './reveal'
import { useTabReorder } from './reorder'
import { useRovingTabs } from './roving'
import { EDGE_FADE_WIDTH, TAB_STRIP_VARIANTS } from './tab-strip-classes'
import { TabStripTab } from './tab-strip-tab'
import type { TabStripProps } from './tab-types'

export function TabStrip<T extends string = string>({
  items,
  activeId,
  onChange,
  variant = 'primary',
  className,
  listClassName,
  tabClassName,
  activeTabClassName,
  inactiveTabClassName,
  actions,
  actionsLabel,
  onReorder,
  onDragStateChange,
  onItemDragStart,
  onItemDragEnd,
  renderOverflow,
  edgeFade = false,
  'aria-label': ariaLabel,
}: TabStripProps<T>) {
  const stripRef = useHorizontalWheelScroll<HTMLDivElement>()
  const { tabRefs, registerTab, navigate } = useRovingTabs(items, onChange)
  // The drag gesture (in-strip reorder and/or a drag out to another surface):
  // its state, its DOM handlers, and what a finished drag resets.
  const drag = useTabReorder<T>({
    ids: items.map((item) => item.id),
    onReorder,
    onDragStateChange,
    onItemDragStart,
    onItemDragEnd,
  })
  const hasOverflowSlot = !!renderOverflow
  // One shared overflow measurement (ResizeObserver + scroll + window-resize),
  // re-measured when the tab set changes width. Drives BOTH the overflow menu
  // (any edge clipped) and the per-edge fade cues.
  // Keep the active tab in view with a clamped, horizontal-only reveal — see
  // `tabReveal`. The reserve holds a revealed tab clear of the edge fades painted
  // over the scroll region below.
  const revealPadding = useMemo<RevealPadding>(
    () => (edgeFade ? { start: EDGE_FADE_WIDTH, end: EDGE_FADE_WIDTH } : {}),
    [edgeFade],
  )
  const revealActive = useRevealActiveTab({
    containerRef: stripRef,
    itemRefs: tabRefs,
    activeId,
    padding: revealPadding,
  })
  // The overflow measurement's ResizeObserver doubles as the resize-reveal signal:
  // a narrower strip must not leave the active tab clipped. Sharing it keeps the
  // "no affordance → no observers" property intact (nothing observes when the
  // strip declares neither an overflow menu nor edge fades).
  const overflow = useTabOverflow(stripRef, [items], hasOverflowSlot || edgeFade, revealActive)
  const overflowing = overflow.left || overflow.right

  // Entrance cue for genuinely NEW tabs only: ids present on first render are
  // seeded as seen (no replay on mount), and stable keys mean a reorder never
  // replays it either. Marked seen in a post-commit effect (ref mutation, no
  // re-render) so the one-shot animation class survives its own 200ms; a
  // mid-animation re-render at worst skips the entrance. Reduced-motion is
  // killed globally in index.css.
  const seenIds = useRef<Set<T> | null>(null)
  if (seenIds.current === null) seenIds.current = new Set(items.map((i) => i.id))
  useEffect(() => {
    const seen = seenIds.current
    if (seen) for (const i of items) seen.add(i.id)
  }, [items])
  const look = TAB_STRIP_VARIANTS[variant]

  return (
    <div
      data-slot="tab-strip"
      data-variant={variant}
      className={cn('flex shrink-0 items-center border-b border-border-soft', look.row, className)}
    >
      {/* Relative wrapper so the edge-fade overlays can pin to the scroll region's
          left/right edges without covering the flanking actions. */}
      <div data-slot="tab-strip-scroll-region" className="relative flex h-full min-w-0 flex-1">
        <div
          ref={stripRef}
          data-slot="tab-strip-list"
          role="tablist"
          aria-label={ariaLabel}
          className={cn(
            // overflow-y-hidden is REQUIRED: with only overflow-x set to auto, CSS
            // computes overflow-y to auto as well, which lets the strip scroll
            // vertically too. Pin it so tabs scroll horizontally only.
            // overscroll-x-contain: at either horizontal end the overscroll must NOT
            // chain outward — unchained, the leftover delta reaches the document and
            // macOS answers with its back/forward rubber band, so the strip visibly
            // springs off the boundary right where the first/last tab lives.
            'flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            'h-full',
            listClassName,
          )}
        >
          {/* `seenIds` is a write-only animation ledger, deliberately not React
            state: recording an id must not interrupt its entrance animation. */}
          {/* eslint-disable-next-line react-hooks/refs */}
          {items.map((item, index) => (
            <TabStripTab
              key={item.id}
              item={item}
              index={index}
              active={item.id === activeId}
              isNew={!seenIds.current?.has(item.id)}
              look={look}
              drag={drag}
              registerTab={registerTab}
              navigate={navigate}
              onChange={onChange}
              tabClassName={tabClassName}
              activeTabClassName={activeTabClassName}
              inactiveTabClassName={inactiveTabClassName}
            />
          ))}
          <div
            className={cn(
              'relative min-w-2 flex-1 self-stretch',
              drag.dragOverEnd && DROP_TARGET_INDICATOR_BEFORE_VERTICAL,
            )}
            {...drag.trailingProps}
          />
        </div>
        {/* Edge fades: a soft gradient over whichever side has tabs clipped, so an
            overflowing strip reads as scrollable. pointer-events-none
            so they never intercept a click on the tabs beneath. */}
        {edgeFade && overflow.left && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-(--z-raised) bg-gradient-to-r from-background to-transparent"
            style={{ width: EDGE_FADE_WIDTH }}
          />
        )}
        {edgeFade && overflow.right && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 z-(--z-raised) bg-gradient-to-l from-background to-transparent"
            style={{ width: EDGE_FADE_WIDTH }}
          />
        )}
      </div>
      {(actions || (hasOverflowSlot && overflowing)) && (
        <div
          data-slot="tab-strip-actions"
          role="group"
          aria-label={actionsLabel ?? `${ariaLabel} actions`}
          className="flex shrink-0 items-center gap-0.5"
        >
          {hasOverflowSlot && overflowing && renderOverflow()}
          {actions}
        </div>
      )}
    </div>
  )
}
