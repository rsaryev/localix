import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { useHorizontalWheelScroll } from '../../lib/use-horizontal-wheel-scroll'
import { motionSafeScrollBehavior } from '../../lib/use-reduced-motion'
import { Chip } from '../../feedback/chip'
import { useTabOverflow } from './overflow'
import { useRevealActiveTab, type RevealPadding } from './reveal'
import { useRovingTabs } from './roving'
import { INDICATOR_INSET, SCROLL_AFFORDANCE_WIDTH } from './tab-strip-classes'
import type { TabBarProps } from './tab-types'

/**
 * The app-standard underline tab strip: icon + label + optional badge, active
 * tab underlined with the foreground color. All tabbed surfaces (Capabilities,
 * settings mobile nav, …) derive from this instead of hand-rolling their own.
 *
 * The ROW is the unit: it is one `--panel-header-height` band (the same measure as
 * `PanelHeader` and the default `WorkbenchToolbar`, which is what sits directly
 * above it in the API workbench) with one bottom seam at the repo-wide chrome
 * weight, and it holds both the scrolling tabs and any `trailing` control. Its
 * former `pt-1`/`pb-2.5` came to ~34px — off the `--chrome-control-*` ladder, which
 * is exactly why aligning anything beside it used to need a hand-tuned nudge.
 */
export function TabBar<T extends string>({
  items,
  active,
  onChange,
  className,
  trailing,
  stretch = false,
  'aria-label': ariaLabel,
}: TabBarProps<T>) {
  const stripRef = useHorizontalWheelScroll<HTMLDivElement>()
  const { tabRefs, registerTab, navigate } = useRovingTabs(items, onChange)
  // ONE measured underline follows the active tab instead of each tab toggling
  // its own after: underline. It updates before paint with no travel animation,
  // so content and navigation state never disagree for a frame.
  // is absolutely positioned INSIDE the scroll container, so it lives in the
  // scrollable content and moves with the strip for free.
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)
  const measureIndicator = useCallback(() => {
    const el = tabRefs.current.get(active)
    if (!el) {
      setIndicator(null)
      return
    }
    setIndicator({
      left: el.offsetLeft + INDICATOR_INSET,
      width: Math.max(el.offsetWidth - INDICATOR_INSET * 2, 0),
    })
  }, [active, tabRefs])
  // Re-measure when the active tab or the tab set changes (labels/badges/order
  // shift positions), before paint so the bar never flashes at a stale spot.
  useLayoutEffect(() => {
    measureIndicator()
  }, [measureIndicator, items])
  // Reveal the active tab on activation (settings search, route restore, keyboard
  // nav). Both edges reserve the chevron width so a revealed tab never lands
  // underneath one of those opaque buttons.
  const revealPadding = useMemo<RevealPadding>(
    () => ({ start: SCROLL_AFFORDANCE_WIDTH, end: SCROLL_AFFORDANCE_WIDTH }),
    [],
  )
  const revealActive = useRevealActiveTab({
    containerRef: stripRef,
    itemRefs: tabRefs,
    activeId: active,
    padding: revealPadding,
  })
  // One ResizeObserver for the whole row: it drives the overflow chevrons, catches
  // size changes the tab set doesn't signal (font load, container reflow) to
  // re-measure the underline, and re-reveals the active tab — otherwise a narrower
  // strip can leave the content saying "Plugins" while the tab row ends at "MCP".
  const handleResize = useCallback(() => {
    measureIndicator()
    revealActive()
  }, [measureIndicator, revealActive])
  const overflow = useTabOverflow(stripRef, [items], true, handleResize)

  const scrollTabs = (direction: -1 | 1) => {
    const strip = stripRef.current
    if (!strip) return
    strip.scrollBy({
      left: direction * Math.max(strip.clientWidth * 0.65, 120),
      behavior: motionSafeScrollBehavior('smooth'),
    })
  }

  return (
    <div
      data-slot="tab-bar"
      // `w-full` + `shrink-0` rather than `flex-1`: the row is now the full row, and
      // several hosts stack it in a COLUMN, where `flex-1` would have let it eat the
      // pane instead of holding its one-band height.
      className="flex h-[var(--panel-header-height)] w-full min-w-0 shrink-0 items-stretch border-b border-border-soft"
    >
      {/* Relative wrapper for the absolutely-pinned scroll affordances, so they
          hug the tab list's edges rather than the trailing control's. */}
      <div className="relative min-w-0 flex-1">
        <div
          ref={stripRef}
          role="tablist"
          aria-label={ariaLabel}
          className={cn(
            // See the TabStrip list above for why overscroll-x-contain is required.
            'relative flex h-full w-full items-stretch gap-0 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            className,
          )}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-foreground"
            style={
              indicator
                ? { width: indicator.width, transform: `translateX(${indicator.left}px)` }
                : { opacity: 0 }
            }
          />
          {items.map(({ id, label, tabId, panelId, icon: Icon, badge, disabled }, index) => {
            const isActive = active === id
            return (
              <button
                key={id}
                ref={registerTab(id)}
                type="button"
                role="tab"
                id={tabId}
                aria-controls={panelId}
                aria-selected={isActive}
                // Roving tabindex + Arrow/Home/End — same ARIA tabs pattern as
                // TabStrip above, so the whole strip is ONE Tab stop.
                tabIndex={isActive ? 0 : -1}
                disabled={disabled}
                onClick={() => !disabled && onChange(id)}
                onKeyDown={(e) => navigate(index, e)}
                // Full-row-height tabs: the label centres in the band and the
                // sliding indicator keeps sitting on the seam, with no padding
                // pair to re-tune when the row measure changes.
                className={cn(
                  'relative flex h-full shrink-0 items-center gap-1.5 px-3.5 text-sm font-medium transition-colors focus-ring',
                  stretch && 'min-w-0 flex-1 justify-center',
                  // The shared sliding indicator above replaces the per-tab
                  // underline; the active tab keeps only its text-color change.
                  isActive ? 'text-foreground' : 'text-text-soft hover:text-foreground',
                )}
              >
                {Icon && <Icon className="size-3.5 opacity-70" />}
                <span>{label}</span>
                {badge !== undefined && (
                  <Chip size="dense" tone={isActive ? 'accent' : 'neutral'} className="py-px">
                    {badge}
                  </Chip>
                )}
              </button>
            )
          })}
        </div>
        {overflow.left && (
          <button
            type="button"
            onClick={() => scrollTabs(-1)}
            style={{ width: SCROLL_AFFORDANCE_WIDTH }}
            className="absolute inset-y-0 left-0 z-(--z-raised) flex items-center justify-start bg-gradient-to-r from-background via-background/90 to-transparent pl-0.5 text-text-soft hover:text-foreground focus-ring"
            aria-label="Scroll tabs left"
          >
            <ChevronLeft className="size-3.5" aria-hidden="true" />
          </button>
        )}
        {overflow.right && (
          <button
            type="button"
            onClick={() => scrollTabs(1)}
            style={{ width: SCROLL_AFFORDANCE_WIDTH }}
            className="absolute inset-y-0 right-0 z-(--z-raised) flex items-center justify-end bg-gradient-to-l from-background via-background/90 to-transparent pr-0.5 text-text-soft hover:text-foreground focus-ring"
            aria-label="Scroll tabs right"
          >
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {trailing != null && (
        <div data-slot="tab-bar-trailing" className="flex shrink-0 items-center">
          {trailing}
        </div>
      )}
    </div>
  )
}
