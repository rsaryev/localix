import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { TabStripVariant } from './tab-strip-classes'

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

export interface TabBarProps<T extends string> {
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
}

export interface TabStripProps<T extends string = string> {
  items: ReadonlyArray<StripTabItem<T>>
  activeId: T | null
  onChange: (id: T) => void
  variant?: TabStripVariant
  className?: string
  listClassName?: string
  tabClassName?: string
  activeTabClassName?: string
  inactiveTabClassName?: string
  actions?: ReactNode
  /** Accessible name for the fixed controls outside the scrollable tab list. */
  actionsLabel?: string
  /** Rendered in the actions area ONLY while the tab list overflows its width
   *  (clipped) — e.g. a "show all tabs" menu. A ResizeObserver on
   *  the scroll container drives it, so it appears exactly when a tab is hidden
   *  and vanishes when everything fits. Opt-in: no observer when unset. */
  renderOverflow?: () => ReactNode
  /** Paint a soft fade over whichever edge has tabs clipped out of view (a cue
   *  that the strip scrolls). Keyed off the same overflow measurement that
   *  drives `renderOverflow`. The gradient fades to `background`, so enable it on
   *  strips whose host is `bg-background`. Opt-in — off by default. */
  edgeFade?: boolean
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
  onItemDragEnd?: (id: T, event: globalThis.DragEvent | null, cancelled: boolean) => void
  /** Every tab list is named independently from adjacent editor actions. */
  'aria-label': string
}
