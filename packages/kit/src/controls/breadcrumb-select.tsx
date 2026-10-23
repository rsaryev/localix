import * as React from 'react'
import { ChevronDown } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../overlays/dropdown-menu'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { BreadcrumbSelectRows } from './breadcrumb-select-rows'
import { BreadcrumbSelectSearch } from './breadcrumb-select-search'

/** One selectable entry in a {@link BreadcrumbSelect} dropdown. */
export interface BreadcrumbSelectItem {
  id: string
  label: string
  /** Optional secondary line for richer hierarchy pickers such as books or sessions. */
  description?: string
  /** Short right-aligned metadata for compact rows, e.g. a source line. */
  hint?: string
  /** Optional leading glyph, e.g. `<Folder className="size-3.5" />`. */
  icon?: React.ReactNode
  /** Size/shape override for richer glyphs such as portrait book covers. */
  iconClassName?: string
  /** The currently-active entry — rendered with the shared accent row. */
  active?: boolean
  /** Keep unavailable descendants visible without allowing out-of-order navigation. */
  disabled?: boolean
  onSelect: () => void
}

/**
 * A list this short is scanned at a glance, so a filter field would only push the rows down and
 * take focus away from them; from this length on, the field is worth its row.
 */
const SEARCH_MIN_ITEMS = 8

export interface BreadcrumbSelectProps {
  /** The text shown on the segment trigger (the active level's label). */
  label: string
  /** Optional leading glyph on the trigger. */
  icon?: React.ReactNode
  items: BreadcrumbSelectItem[]
  /** Optional footer action ("Search all…") that escapes to the full switcher. */
  onSearchAll?: () => void
  searchAllLabel?: string
  /** Enables local filtering once the list has {@link SEARCH_MIN_ITEMS} rows or more. */
  searchPlaceholder?: string
  /** Observes the primitive's open state, e.g. to revalidate a sibling snapshot. */
  onOpenChange?: (open: boolean) => void
  /** Message when `items` is empty (and no search-all is offered). */
  placeholder?: string
  ariaLabel: string
  /** Marks this segment as the current destination in its enclosing breadcrumb. */
  ariaCurrent?: React.AriaAttributes['aria-current']
  /** Extra classes for the trigger button (width caps, emphasis, …). */
  className?: string
  /** Single-line rows with secondary information in a tooltip. */
  density?: 'default' | 'compact'
  /** Splits label navigation from the menu chevron. Omit when navigation is a no-op. */
  onNavigate?: () => void
}

const SEGMENT_BTN =
  'flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 leading-none transition-colors cursor-pointer hover:bg-surface-hover outline-none focus-ring'

/**
 * A data-agnostic breadcrumb-segment picker: a compact segment button that opens
 * an INLINE dropdown anchored to the segment,
 * listing `items`. The active item uses the shared {@link SELECTED_ROW} accent;
 * an optional "Search all…" footer escapes to a full modal switcher for long lists.
 *
 * Keyboard access (arrows / enter / esc) comes free from the shared
 * `DropdownMenu` primitive.
 */
export function BreadcrumbSelect({
  label,
  icon,
  items,
  onSearchAll,
  searchAllLabel = 'Search all…',
  searchPlaceholder,
  onOpenChange,
  placeholder = 'Nothing here yet',
  ariaLabel,
  ariaCurrent,
  className,
  density = 'default',
  onNavigate,
}: BreadcrumbSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const searchEnabled = Boolean(searchPlaceholder && items.length >= SEARCH_MIN_ITEMS)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleItems = normalizedQuery
    ? items.filter((item) =>
        `${item.label}\n${item.description ?? ''}\n${item.hint ?? ''}`
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
    : items

  // What a closed menu renders: the rows it closed with (its exit animation), never a rebuild.
  const [closedItems, setClosedItems] = React.useState<readonly BreadcrumbSelectItem[]>([])
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setClosedItems(visibleItems)
    if (!next) setQuery('')
    onOpenChange?.(next)
  }

  React.useEffect(() => {
    if (!open || !searchEnabled) return
    const frame = requestAnimationFrame(() =>
      searchInputRef.current?.focus({ preventScroll: true }),
    )
    return () => cancelAnimationFrame(frame)
  }, [open, searchEnabled])

  React.useEffect(() => {
    if (!open || normalizedQuery) return
    const frame = requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>('[aria-current]')
        ?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, normalizedQuery])

  // One menu body for both trigger shapes — the split/single distinction is
  // entirely about the trigger, never the content.
  const menu = (
    <DropdownMenuContent
      align="start"
      // Viewport-only limits let a long symbol list cover the whole editor.
      // Reserve a bounded picker, with the search outside its scrolling list.
      className="flex max-h-[min(24rem,50dvh,var(--radix-dropdown-menu-content-available-height))] min-w-[min(13rem,calc(100vw-2rem))] max-w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden"
      onKeyDown={(event) => {
        if (
          event.key !== 'ArrowDown' &&
          event.key !== 'ArrowUp' &&
          event.key !== 'Home' &&
          event.key !== 'End'
        ) {
          return
        }
        const content = event.currentTarget
        requestAnimationFrame(() => {
          const highlighted = content.querySelector<HTMLElement>('[data-highlighted]')
          highlighted?.focus()
        })
      }}
    >
      {searchEnabled ? (
        <BreadcrumbSelectSearch
          inputRef={searchInputRef}
          query={query}
          onQueryChange={setQuery}
          placeholder={searchPlaceholder}
          hasEnabledMatch={visibleItems.some((item) => !item.disabled)}
          statusText={
            normalizedQuery
              ? `${visibleItems.length} ${visibleItems.length === 1 ? 'result' : 'results'}`
              : `${items.length} ${items.length === 1 ? 'item' : 'items'}`
          }
        />
      ) : null}
      <div
        ref={listRef}
        data-slot="breadcrumb-select-list"
        className="min-h-0 overflow-y-auto overscroll-contain scrollbar-thin"
      >
        {visibleItems.length === 0 && !onSearchAll ? (
          <div className="px-2.5 py-2 text-xs text-text-faint select-none">
            {normalizedQuery ? 'No matches' : placeholder}
          </div>
        ) : null}
        {visibleItems.length === 0 && onSearchAll ? (
          <div className="px-2.5 py-2 text-xs text-text-faint select-none">No matches</div>
        ) : null}
        <BreadcrumbSelectRows items={open ? visibleItems : closedItems} density={density} />
      </div>
      {onSearchAll ? (
        <>
          {visibleItems.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={onSearchAll} className="text-xs text-text-soft">
            <span className="min-w-0 flex-1 truncate">{searchAllLabel}</span>
          </DropdownMenuItem>
        </>
      ) : null}
    </DropdownMenuContent>
  )

  if (onNavigate) {
    return (
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        {/* Open state = the 11% `surface-active` veil, not `bg-surface-raised`: raised mixes from
            a darker ground than the breadcrumb bar, so an open segment read as a black box. */}
        <div className={cn(SEGMENT_BTN, 'group gap-0 p-0', open && 'bg-surface-active', className)}>
          <button
            type="button"
            aria-label={`Go to ${label}`}
            aria-current={ariaCurrent}
            title={`Go to ${label}`}
            onClick={onNavigate}
            className="flex min-w-0 items-center gap-1 rounded-l-md py-1 pl-1.5 pr-1 leading-none outline-none focus-ring hover:bg-surface-hover"
          >
            {icon ? <span className="flex shrink-0 items-center opacity-60">{icon}</span> : null}
            <span className="truncate">{label}</span>
          </button>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={ariaLabel}
              title={ariaLabel}
              className={cn(
                'flex shrink-0 items-center self-stretch rounded-r-md border-l py-1 pl-0.5 pr-1 leading-none outline-none focus-ring hover:bg-surface-hover',
                open
                  ? 'border-control-border/50'
                  : 'border-transparent group-hover:border-control-border/50',
              )}
            >
              <ChevronDown
                className={cn(
                  'size-3 shrink-0 text-text-faint transition-transform',
                  open && 'rotate-180',
                )}
              />
            </button>
          </DropdownMenuTrigger>
        </div>
        {menu}
      </DropdownMenu>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-current={ariaCurrent}
          title={ariaLabel}
          className={cn(SEGMENT_BTN, open && 'bg-surface-active', className)}
        >
          {icon ? <span className="flex shrink-0 items-center opacity-60">{icon}</span> : null}
          <span className="truncate">{label}</span>
          <ChevronDown
            className={cn(
              'size-3 shrink-0 text-text-faint transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
      </DropdownMenuTrigger>
      {menu}
    </DropdownMenu>
  )
}
