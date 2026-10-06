import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { useHorizontalWheelScroll } from '../../lib/use-horizontal-wheel-scroll'
import { motionSafeScrollBehavior } from '../../lib/use-reduced-motion'
import { useTabOverflow } from './overflow'
import { useRevealActiveTab, type RevealPadding } from './reveal'
import { useTabReorder } from './reorder'
import { IconButton } from '../../controls/icon-button'
import { ChordHint } from '../../keyboard/chord-hint'
import { Chip } from '../../feedback/chip'
import { nextEnabledIndex, edgeEnabledIndex } from './keyboard'
import { DROP_TARGET_INDICATOR_BEFORE_VERTICAL } from '../../lists/drop-target'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../../overlays/context-menu'

/** Width of the TabStrip edge-fade overlays (`w-6`) — kept as a number so the
 *  reveal below can hold a revealed tab clear of the gradient painted over it. */
const EDGE_FADE_WIDTH = 24
/** Width of the TabBar scroll-chevron buttons (`w-8`). These are OPAQUE and
 *  clickable, so a tab revealed underneath one is not merely dim — it is
 *  unclickable, which is how the last tab became impossible to select. */
const SCROLL_AFFORDANCE_WIDTH = 32

export interface TabMenuItem<T extends string = string> {
  label: string
  onSelect: (id: T) => void
  /** Render a separator above this entry. */
  separatorBefore?: boolean
  disabled?: boolean
  /** Keybinding-registry id — its live chord is shown as a right-aligned hint. */
  chordId?: string
}

export interface TabItem<T extends string = string> {
  id: T
  label: string
  /** DOM id of this tab. Pair with `panelId` for a complete ARIA relationship. */
  tabId?: string
  /** DOM id of the panel controlled by this tab. */
  panelId?: string
  icon?: LucideIcon
  /** Small count/badge rendered after the label (omitted when undefined). */
  badge?: string | number
  /** Disabled tabs are unclickable and skipped by arrow/Home/End navigation. */
  disabled?: boolean
}

/** Stable DOM relationship ids for any tab implementation built on these primitives. */
export function useTabPanelIds(scope = 'tabs') {
  const reactId = useId()
  return useMemo(() => {
    const prefix = `${reactId}-${encodeURIComponent(scope)}`
    return {
      tabId: (id: string) => `${prefix}-tab-${encodeURIComponent(id)}`,
      panelId: (id: string) => `${prefix}-panel-${encodeURIComponent(id)}`,
      item: (id: string) => ({
        tabId: `${prefix}-tab-${encodeURIComponent(id)}`,
        panelId: `${prefix}-panel-${encodeURIComponent(id)}`,
      }),
    }
  }, [reactId, scope])
}

interface TabBarProps<T extends string> {
  items: ReadonlyArray<TabItem<T>>
  active: T
  /** Distribute tabs evenly across the whole panel width. */
  stretch?: boolean
  onChange: (id: T) => void
  /** Classes for the scrolling tab list (gutters). The row itself owns its height
   *  and its seam — do not restate either here. */
  className?: string
  /** Control that belongs on the same line as the tabs (a scope picker, a body-type
   *  select, a status readout). It renders INSIDE the row, after the scrolling tab
   *  strip, so the primitive keeps drawing exactly ONE seam across the full row.
   *  Before this slot existed, such consumers suppressed the seam with `border-b-0`
   *  and redrew it on a wrapper — two places to keep in sync for one line. The slot
   *  centres its content vertically; a child that wants a full-height divider says
   *  `self-stretch border-l` itself. */
  trailing?: ReactNode
  /** Accessible name for this navigation set. */
  'aria-label': string
}

export interface StripTabItem<T extends string = string> {
  id: T
  label: ReactNode
  /** DOM id of this tab. Pair with `panelId` for a complete ARIA relationship. */
  tabId?: string
  /** DOM id of the panel controlled by this tab. */
  panelId?: string
  title?: string
  icon?: ReactNode
  hint?: ReactNode
  badge?: ReactNode
  /** Colour of the badge pill: neutral by default, or an error/warn accent (e.g.
   *  the Problems tab diagnostics count). */
  badgeTone?: 'default' | 'error' | 'warn'
  disabled?: boolean
  italic?: boolean
  faded?: boolean
  /** Unsaved-buffer indicator: a dot shown in the close-button slot, swapped for
   *  the X on hover. Only meaningful together with `onClose`. */
  dirty?: boolean
  /** Attention indicator: a small accent dot BEFORE the label, marking unseen
   *  background activity (e.g. a hidden terminal that produced output). Distinct
   *  from `dirty` in slot + color; cleared once the tab is shown. */
  attention?: boolean
  closeLabel?: string
  onClose?: (id: T) => void
  onAuxClose?: (id: T) => void
  /** Right-click context-menu entries for this tab (omitted → no menu). */
  menu?: ReadonlyArray<TabMenuItem<T>>
  /** A host may use a platform menu instead of the built-in HTML context menu. */
  onContextMenu?: (id: T, event: React.MouseEvent) => void
  /** Double-click the tab (e.g. pin an ephemeral preview tab). */
  onDoubleClick?: (id: T) => void
  renderWrapper?: (node: ReactNode, item: StripTabItem<T>, active: boolean) => ReactNode
}

export interface TabStripProps<T extends string = string> {
  items: ReadonlyArray<StripTabItem<T>>
  activeId: T | null
  onChange: (id: T) => void
  variant?: 'primary' | 'underline' | 'subtle' | 'compact'
  className?: string
  listClassName?: string
  tabClassName?: string
  activeTabClassName?: string
  inactiveTabClassName?: string
  actions?: ReactNode
  /** Accessible name for the fixed controls outside the scrollable tab list. */
  actionsLabel?: string
  trailingFill?: boolean
  /** Rendered in the actions area ONLY while the tab list overflows its width
   *  (clipped) — e.g. a "show all tabs" menu. A ResizeObserver on
   *  the scroll container drives it, so it appears exactly when a tab is hidden
   *  and vanishes when everything fits. Opt-in: no observer when unset. */
  renderOverflow?: () => ReactNode
  /** Paint a soft fade over whichever edge has tabs clipped out of view (a cue
   *  that the strip scrolls). Keyed off the same overflow measurement that
   *  drives `renderOverflow`. The gradient fades to `edgeFadeClassName` (default
   *  `from-background`), so enable it on strips whose host is `bg-background`; a
   *  strip on another surface passes its own `from-*` token. Opt-in — off by
   *  default so existing consumers are visually unchanged. */
  edgeFade?: boolean
  /** Tailwind `from-*` class the edge fade blends toward (its host background).
   *  Defaults to `from-background`. Only meaningful with `edgeFade`. */
  edgeFadeClassName?: string
  /** Enable drag-to-reorder: dropping `fromId` on `toId` calls this — `toId` is
   *  null when dropped on the trailing area (move to end). Tabs become draggable
   *  only when provided, so other TabStrip consumers are unaffected. */
  onReorder?: (fromId: T, toId: T | null) => void
  /** Notified when a tab drag starts (true, with the dragged id) / ends (false)
   *  — lets a host reveal external drop targets (e.g. dock zones) and know which
   *  tab is in flight so a drop can move it. Only meaningful with `onReorder`. */
  onDragStateChange?: (dragging: boolean, id?: T) => void
  /** Make items draggable to ANOTHER surface (no in-strip reorder). The host
   *  arms the drag (set its payload, flip a bus) here. Mutually used instead of
   *  `onReorder` — the section strip drags icons out to the rail this way. */
  onItemDragStart?: (id: T, e: React.DragEvent) => void
  onItemDragEnd?: () => void
  /** Every tab list is named independently from adjacent editor actions. */
  'aria-label': string
}

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
  trailingFill = true,
  onReorder,
  onDragStateChange,
  onItemDragStart,
  onItemDragEnd,
  renderOverflow,
  edgeFade = false,
  edgeFadeClassName = 'from-background',
  'aria-label': ariaLabel,
}: TabStripProps<T>) {
  const stripRef = useHorizontalWheelScroll<HTMLDivElement>()
  const tabRefs = useRef(new Map<T, HTMLButtonElement>())
  // The drag gesture (in-strip reorder and/or a drag out to another surface):
  // its state, its DOM handlers, and what a finished drag resets.
  const drag = useTabReorder<T>({ onReorder, onDragStateChange, onItemDragStart, onItemDragEnd })
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
  const isPrimary = variant === 'primary'
  const isUnderline = variant === 'underline'
  const isCompact = variant === 'compact'

  return (
    <div
      data-slot="tab-strip"
      data-variant={variant}
      className={cn(
        'flex shrink-0 items-center border-b border-border-soft',
        isPrimary
          ? 'h-[var(--chrome-control-touch)] px-2'
          : isUnderline
            ? 'h-[var(--chrome-control-lg)] px-1.5'
            : 'h-[var(--chrome-control-md)] px-1.5',
        className,
      )}
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
          {items.map((item, index) => {
            const active = item.id === activeId
            const isNew = !seenIds.current?.has(item.id)
            const tabClasses = cn(
              'group relative flex shrink-0 items-center outline-none transition-colors',
              isPrimary
                ? 'h-[var(--chrome-control-lg)] max-w-56 rounded-sm px-(--workbench-gutter) text-sm font-normal leading-none focus-within:bg-surface-hover/40 focus-within:text-foreground'
                : isUnderline
                  ? 'h-[var(--chrome-control-sm)] max-w-44 rounded-sm px-2 text-2xs font-medium leading-none focus-within:bg-surface-hover/40 focus-within:text-foreground'
                  : isCompact
                    ? 'h-[var(--chrome-control-sm)] rounded-sm px-1.5 text-2xs focus-within:bg-surface-hover focus-within:text-foreground'
                    : 'h-[var(--chrome-control-sm)] rounded-sm px-1.5 text-2xs focus-within:bg-surface-hover focus-within:text-foreground',
              active
                ? isPrimary
                  ? 'text-foreground after:absolute after:inset-x-2 after:-bottom-1 after:h-0.5 after:rounded-full after:bg-foreground'
                  : isUnderline
                    ? 'bg-surface-hover/60 text-foreground after:absolute after:inset-x-1.5 after:-bottom-1 after:h-px after:rounded-full after:bg-foreground/80'
                    : // subtle + compact: the active tab was distinguished only by
                      // brighter text — nearly indistinguishable from an inactive tab
                      // when the group is unfocused. A filled `surface-active` rest state reads
                      // as clearly selected and stays distinct from the `surface-hover`
                      // used for inactive hover, in both light and dark.
                      'bg-surface-active text-foreground'
                : isPrimary
                  ? 'text-text-soft hover:bg-surface-hover/50 hover:text-foreground focus-within:after:absolute focus-within:after:inset-x-2 focus-within:after:-bottom-1 focus-within:after:h-px focus-within:after:rounded-full focus-within:after:bg-ring/70'
                  : isUnderline
                    ? 'text-text-soft hover:bg-surface-hover/50 hover:text-foreground focus-within:after:absolute focus-within:after:inset-x-1.5 focus-within:after:-bottom-1 focus-within:after:h-px focus-within:after:rounded-full focus-within:after:bg-ring/70'
                    : 'text-text-soft hover:bg-surface-hover hover:text-foreground',
              active ? activeTabClassName : inactiveTabClassName,
              item.italic && 'italic',
              item.faded && 'opacity-50',
              item.disabled && 'cursor-not-allowed opacity-50',
              // Subtle scale-fade entrance for a just-created tab.
              isNew && 'animate-in fade-in zoom-in-90 duration-(--dur-base)',
              // Reorder feedback: dim the tab being dragged; show an insertion caret
              // on the current drop target (the dragged tab lands before it).
              drag.draggingId === item.id && 'opacity-40',
              drag.dragOverId === item.id && DROP_TARGET_INDICATOR_BEFORE_VERTICAL,
              tabClassName,
            )
            const button = (
              <div
                className={tabClasses}
                {...drag.tabProps(item.id)}
                onContextMenu={(event) => item.onContextMenu?.(item.id, event)}
                onAuxClick={(e) => {
                  if (e.button === 1 && item.onAuxClose) {
                    e.preventDefault()
                    item.onAuxClose(item.id)
                  }
                }}
              >
                <button
                  ref={(node) => {
                    if (node) tabRefs.current.set(item.id, node)
                    else tabRefs.current.delete(item.id)
                  }}
                  type="button"
                  role="tab"
                  id={item.tabId}
                  aria-controls={item.panelId}
                  aria-selected={active}
                  disabled={item.disabled}
                  tabIndex={active ? 0 : -1}
                  title={item.title}
                  onClick={() => !item.disabled && onChange(item.id)}
                  onDoubleClick={
                    item.onDoubleClick
                      ? () => !item.disabled && item.onDoubleClick?.(item.id)
                      : undefined
                  }
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || item.disabled) return
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onChange(item.id)
                      return
                    }
                    const isArrow = e.key === 'ArrowRight' || e.key === 'ArrowLeft'
                    const isEdge = e.key === 'Home' || e.key === 'End'
                    if (!isArrow && !isEdge) return
                    e.preventDefault()
                    const target = isEdge
                      ? edgeEnabledIndex(items, e.key === 'Home' ? 'first' : 'last')
                      : nextEnabledIndex(items, index, e.key === 'ArrowRight' ? 1 : -1)
                    if (target < 0) return
                    onChange(items[target].id)
                    // `preventScroll`: the browser's own focus scrolling walks every
                    // scrollable ancestor (it can scroll the PAGE). The activation
                    // above drives our clamped, horizontal-only reveal instead.
                    tabRefs.current.get(items[target].id)?.focus({ preventScroll: true })
                  }}
                  data-tabstrip-id={item.id}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left outline-none focus-ring disabled:cursor-not-allowed"
                >
                  {/* Attention pip: unseen background activity. Suppressed on the active
                  tab (you're looking at it, so it's already "seen"). */}
                  {item.attention && !active && (
                    <span
                      aria-hidden
                      className="mr-0.5 size-1.5 shrink-0 rounded-full bg-status-info"
                    />
                  )}
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                  {item.hint && (
                    <span className="shrink-0 truncate text-2xs text-text-faint">{item.hint}</span>
                  )}
                  {item.badge && (
                    <Chip
                      size="dense"
                      tone={
                        item.badgeTone === 'error'
                          ? 'error'
                          : item.badgeTone === 'warn'
                            ? 'warning'
                            : 'neutral'
                      }
                      className={cn(
                        'shrink-0 py-px',
                        (!item.badgeTone || item.badgeTone === 'default') && 'text-text-soft',
                      )}
                    >
                      {item.badge}
                    </Chip>
                  )}
                </button>
                {item.onClose && (
                  <span className="relative ml-px flex items-center">
                    {/* Dirty dot: shown in the close slot while unsaved and the tab
                      isn't hovered/focused; the X below takes over on hover so the
                      tab can still be closed. */}
                    {item.dirty && (
                      <span
                        aria-hidden
                        className="lx-tab-dirty-indicator pointer-events-none absolute inset-0 flex items-center justify-center group-hover:opacity-0 group-focus-within:opacity-0"
                      >
                        <span className="size-2 rounded-full bg-foreground/70" />
                      </span>
                    )}
                    <IconButton
                      size="xs"
                      aria-label={item.closeLabel ?? 'Close tab'}
                      tooltip={item.closeLabel ?? 'Close tab'}
                      className={cn(
                        'lx-hover-actions opacity-60 hover:opacity-100',
                        !active &&
                          !isPrimary &&
                          !isUnderline &&
                          !item.dirty &&
                          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                        item.dirty &&
                          'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
                        (isPrimary || isUnderline) && 'relative z-(--z-raised)',
                      )}
                      onClick={(e) => {
                        e.stopPropagation()
                        item.onClose?.(item.id)
                      }}
                    >
                      <X className="size-3" />
                    </IconButton>
                  </span>
                )}
              </div>
            )
            const withMenu =
              item.menu && item.menu.length > 0 ? (
                <ContextMenu>
                  <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
                  <ContextMenuContent>
                    {item.menu.map((m, i) => (
                      <div key={m.label}>
                        {m.separatorBefore && i > 0 && <ContextMenuSeparator />}
                        <ContextMenuItem disabled={m.disabled} onSelect={() => m.onSelect(item.id)}>
                          {m.label}
                          {m.chordId && <ChordHint commandId={m.chordId} />}
                        </ContextMenuItem>
                      </div>
                    ))}
                  </ContextMenuContent>
                </ContextMenu>
              ) : (
                button
              )
            return item.renderWrapper ? (
              item.renderWrapper(withMenu, item, active)
            ) : (
              <div key={item.id}>{withMenu}</div>
            )
          })}
          {trailingFill && (
            <div
              className={cn(
                'relative min-w-2 flex-1 self-stretch',
                drag.dragOverEnd && DROP_TARGET_INDICATOR_BEFORE_VERTICAL,
              )}
              {...drag.trailingProps}
            />
          )}
        </div>
        {/* Edge fades: a soft gradient over whichever side has tabs clipped, so an
            overflowing strip reads as scrollable. pointer-events-none
            so they never intercept a click on the tabs beneath. */}
        {edgeFade && overflow.left && (
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-y-0 left-0 z-(--z-raised) w-6 bg-gradient-to-r to-transparent',
              edgeFadeClassName,
            )}
          />
        )}
        {edgeFade && overflow.right && (
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-y-0 right-0 z-(--z-raised) w-6 bg-gradient-to-l to-transparent',
              edgeFadeClassName,
            )}
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
  const tabRefs = useRef(new Map<T, HTMLButtonElement>())
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
    // Mirror the old per-tab underline geometry (after:inset-x-2 → 8px inset).
    const inset = 8
    setIndicator({ left: el.offsetLeft + inset, width: Math.max(el.offsetWidth - inset * 2, 0) })
  }, [active])
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
                ref={(node) => {
                  if (node) tabRefs.current.set(id, node)
                  else tabRefs.current.delete(id)
                }}
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
                onKeyDown={(e) => {
                  const isArrow = e.key === 'ArrowRight' || e.key === 'ArrowLeft'
                  const isEdge = e.key === 'Home' || e.key === 'End'
                  if (!isArrow && !isEdge) return
                  e.preventDefault()
                  const target = isEdge
                    ? edgeEnabledIndex(items, e.key === 'Home' ? 'first' : 'last')
                    : nextEnabledIndex(items, index, e.key === 'ArrowRight' ? 1 : -1)
                  if (target < 0) return
                  onChange(items[target].id)
                  // See TabStrip: keep the browser's focus scrolling out of the
                  // page's vertical axis; our reveal owns the horizontal one.
                  tabRefs.current.get(items[target].id)?.focus({ preventScroll: true })
                }}
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
            className="absolute inset-y-0 left-0 z-(--z-raised) flex w-8 items-center justify-start bg-gradient-to-r from-background via-background/90 to-transparent pl-0.5 text-text-soft hover:text-foreground focus-ring"
            aria-label="Scroll tabs left"
          >
            <ChevronLeft className="size-3.5" aria-hidden="true" />
          </button>
        )}
        {overflow.right && (
          <button
            type="button"
            onClick={() => scrollTabs(1)}
            className="absolute inset-y-0 right-0 z-(--z-raised) flex w-8 items-center justify-end bg-gradient-to-l from-background via-background/90 to-transparent pr-0.5 text-text-soft hover:text-foreground focus-ring"
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

type TabPanelProps = Omit<ComponentProps<'div'>, 'id' | 'aria-labelledby' | 'hidden'> & {
  /** DOM id referenced by the owning tab's `aria-controls`. */
  id: string
  /** DOM id of the owning tab. */
  'aria-labelledby': string
  /** Inactive panels stay mounted for editor/view-state preservation but leave the a11y tree. */
  active: boolean
}

/**
 * Accessible, keep-alive panel paired with a `TabBar` or `TabStrip` item.
 *
 * Keeping the wrapper mounted preserves editor cursors, scroll positions and live
 * plugin state; the native `hidden` attribute removes inactive content from both
 * layout and the accessibility tree without inventing a second state mechanism.
 */
export function TabPanel({ active, className, ...props }: TabPanelProps) {
  return (
    <div
      data-slot="tab-panel"
      role="tabpanel"
      hidden={!active}
      className={cn('min-h-0 min-w-0', !active && 'hidden', className)}
      {...props}
    />
  )
}

export type { TabBarProps, TabPanelProps }
