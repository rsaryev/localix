import {
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { PanelLeft, type LucideIcon } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Select } from '../controls/select'
import { createTypeaheadBuffer } from '../lib/typeahead'
import { POPOVER_MATERIAL } from '../overlays/popover-surface'
import { SectionLabel } from './section-label'
import { useSidebarNavPeek, type SidebarNavPeek } from './sidebar-nav-peek'

export interface SidebarNavItem {
  id: string
  label: string
  icon?: ComponentType<{ className?: string }>
  /** How many it holds, at the end of the row. */
  count?: number
  /** Anything else at the end of the row instead of a count: a dot, a "New" chip. */
  badge?: ReactNode
  /** A line about the section, shown in the narrow select under its label. */
  description?: string
}

export interface SidebarNavGroup {
  id: string
  /** A small heading; a group without one sits at the top. */
  label?: string
  items: readonly SidebarNavItem[]
}

/**
 * How much room the host gives it, chosen from its own pane's width: the grouped column, a column
 * of icons, or one select in the header.
 */
export type SidebarNavMode = 'full' | 'compact' | 'select'

const ROW =
  'flex h-(--chrome-control-lg) w-full items-center gap-2.5 rounded-md text-left text-sm transition-colors duration-(--dur-fast) focus-ring'
const REST = 'text-text-soft hover:bg-surface-hover hover:text-foreground'
const CURRENT = 'bg-surface-active font-medium text-foreground'

const counted = (count: number) => count.toLocaleString('en-US')

/**
 * THE SIDEBAR of a pane that has sections — a store's shelves, the settings' pages. One component
 * in three modes the host picks from its pane's width: `full` is the grouped column (a search
 * slot on top, small headings, rows of icon, label and a count or badge); `compact` is a rail of
 * icons that keeps a fixed width in the layout and opens a panel OVER the content (labels, headings,
 * counts) on hover after a short dwell, on keyboard focus and on a touch, and closes on leaving, Esc,
 * choosing a row or focus moving away, so nothing beside it ever moves (the icons keep their place
 * when it opens: each heading takes the slot of the divider it replaces); `select` is one picker for
 * a header, the search slot beside it. Rows are 32px with the selected veil, and the column is one tab stop:
 * ↑/↓ move, Home/End jump, typed letters find a row, Enter or Space opens it. A group with no
 * rows is not drawn, so a section that holds nothing is hidden by leaving it out.
 */
export function SidebarNav({
  label,
  groups,
  active,
  onSelect,
  mode = 'full',
  search,
  className,
  peek,
}: {
  /** Names the navigation landmark (and the select, in `select` mode). */
  label: string
  groups: readonly SidebarNavGroup[]
  active: string
  onSelect: (id: string) => void
  mode?: SidebarNavMode
  /** A search field: above the groups in `full`, beside the picker in `select`, absent in `compact`. */
  search?: ReactNode
  className?: string
  /** Timing of the compact panel; tests inject their own timers. */
  peek?: SidebarNavPeek
}) {
  const shown = groups.filter((group) => group.items.length > 0)
  const items = useMemo(() => shown.flatMap((group) => group.items), [shown])
  const [focused, setFocused] = useState<string | null>(null)
  const rows = useRef(new Map<string, HTMLButtonElement>())
  const typeahead = useRef(createTypeaheadBuffer({ timeoutMs: 600 }))
  const rail = useRef<HTMLDivElement>(null)
  const panel = useSidebarNavPeek(mode === 'compact', rail, peek)
  const open = panel.open

  if (mode === 'select') {
    const options = items.map((item) => ({
      value: item.id,
      label: item.count === undefined ? item.label : `${item.label} · ${counted(item.count)}`,
      icon: item.icon as LucideIcon | undefined,
      ...(item.description ? { description: item.description } : {}),
    }))
    return (
      <div className={cn('flex min-w-0 items-center gap-2', className)}>
        <Select
          aria-label={label}
          value={active}
          placeholder="Choose a section"
          onValueChange={onSelect}
          options={options}
          size="md"
          className="max-w-56 min-w-0 shrink"
        />
        {search && <div className="min-w-0 flex-1">{search}</div>}
      </div>
    )
  }

  const stop = items.some((item) => item.id === focused) ? focused : active
  const move = (index: number) => {
    const item = items[Math.max(0, Math.min(items.length - 1, index))]
    if (!item) return
    setFocused(item.id)
    rows.current.get(item.id)?.focus()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const at = items.findIndex((item) => rows.current.get(item.id) === document.activeElement)
    if (at < 0) return
    if (event.key === 'ArrowDown') move(at + 1)
    else if (event.key === 'ArrowUp') move(at - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(items.length - 1)
    else if (event.key.length === 1 && /\S/.test(event.key) && !event.metaKey && !event.ctrlKey) {
      const next = typeahead.current.handleChar(
        event.key,
        items.map((item) => item.label),
        at,
      )
      if (next < 0) return
      move(next)
    } else return
    event.preventDefault()
  }

  const row = (item: SidebarNavItem) => {
    const { id, label: itemLabel, icon: Icon, count, badge } = item
    const current = id === active
    const name = count === undefined ? itemLabel : `${itemLabel}, ${counted(count)}`
    const button = (
      <button
        key={id}
        ref={(el) => void (el ? rows.current.set(id, el) : rows.current.delete(id))}
        type="button"
        tabIndex={id === stop ? 0 : -1}
        aria-current={current ? 'page' : undefined}
        {...(mode === 'compact' ? { 'aria-label': name } : {})}
        onClick={() => {
          onSelect(id)
          panel.close()
        }}
        onFocus={() => setFocused(id)}
        className={cn(ROW, mode === 'compact' ? 'px-[11px]' : 'px-2.5', current ? CURRENT : REST)}
      >
        {Icon && (
          <Icon
            className={cn('size-4 shrink-0', current ? 'text-foreground' : 'text-text-faint')}
            aria-hidden
          />
        )}
        {(mode === 'full' || open) && (
          <>
            <span className="min-w-0 flex-1 truncate">{itemLabel}</span>
            {badge ??
              (count !== undefined && (
                <span className="shrink-0 text-2xs font-normal text-text-faint tabular-nums">
                  {counted(count)}
                </span>
              ))}
          </>
        )}
      </button>
    )
    return button
  }

  const compact = mode === 'compact'
  return (
    <div
      ref={compact ? rail : undefined}
      data-sidebar-rail={compact ? '' : undefined}
      className={cn('flex min-h-0 flex-col gap-4', compact && 'relative', className)}
      {...(compact ? panel.handlers : {})}
    >
      {mode === 'full' && search}
      <nav
        aria-label={label}
        onKeyDown={onKeyDown}
        data-state={compact ? (open ? 'open' : 'closed') : undefined}
        className={cn(
          'flex flex-col',
          !compact && 'gap-5',
          // The rail's width stays reserved by the wrapper; the open panel is out of flow, above
          // the content, so opening it never re-lays-out what sits beside it. Its edge is the
          // material's one hairline ring: the border stays transparent so the icons keep their x.
          compact &&
            cn(
              'absolute top-0 left-0 z-20 max-h-full gap-1 overflow-x-hidden overflow-y-auto rounded-lg border border-transparent px-2 py-2 motion-safe:transition-[width,box-shadow] motion-safe:duration-(--dur-fast)',
              open ? `w-56 ${POPOVER_MATERIAL}` : 'w-full',
            ),
        )}
      >
        {compact && (
          <button
            type="button"
            tabIndex={-1}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
            onClick={panel.toggle}
            className={cn(ROW, 'px-[11px] text-text-faint hover:text-foreground')}
          >
            <PanelLeft className="size-4 shrink-0" aria-hidden />
            {open && <span className="min-w-0 flex-1 truncate">{label}</span>}
          </button>
        )}
        {shown.map((group) => (
          <div
            key={group.id}
            role="group"
            aria-label={group.label}
            className="flex flex-col gap-0.5"
          >
            {group.label &&
              (compact ? (
                // One slot, two looks: the divider between rail groups, the heading in the panel.
                <div className="flex h-6 items-center">
                  {open ? (
                    <SectionLabel className="px-2.5">{group.label}</SectionLabel>
                  ) : (
                    <span className="mx-3 h-px flex-1 bg-border-faint" aria-hidden />
                  )}
                </div>
              ) : (
                <SectionLabel className="px-2.5 pb-1">{group.label}</SectionLabel>
              ))}
            {group.items.map(row)}
          </div>
        ))}
      </nav>
    </div>
  )
}
