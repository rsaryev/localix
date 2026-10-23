import type { MenuActionEntry, MenuEntry } from './status-items'

/**
 * The LIST half of a status item's menu — the part every contributing mini app writes the same way
 * and got subtly wrong in a different place.
 *
 * A status item's menu is two things stacked: what the mini app can DO, and what it currently HAS.
 * The second half is always a live collection — open books, saved connections, running tunnels,
 * boards, courses, charts, environments — and it always needs the same four decisions:
 *
 *   - a TITLE, so the rows are not mistaken for more commands;
 *   - a LIMIT, because a menu is not a file browser;
 *   - an honest OVERFLOW row, because a list that stops without saying so reads as the whole list
 *     and sends the person looking for something that is right there;
 *   - nothing at all when the collection is empty — including no title and no separator.
 *
 * Every mini app made those four decisions independently. Three spelled the overflow row by hand
 * with three different phrasings, two forgot it and truncated silently, and the empty case left a
 * dangling separator in most of them. This is one implementation of the four, and it returns
 * entries — so a caller still decides where the section sits and what surrounds it.
 */
export interface StatusMenuListOptions<T> {
  /** Group title above the rows. Dropped with the rest when the collection is empty. */
  header?: string
  items: readonly T[]
  /** How many rows before the remainder collapses into one row. */
  limit?: number
  /** One item as a row. Ids must be unique within the menu — namespace them. */
  row: (item: T, index: number) => MenuActionEntry
  /** The surface that lists ALL of them — where the overflow row goes. */
  onOverflow?: () => void
  /** What that surface is called: `4 more in the workspace…` is the default phrasing. */
  overflowLabel?: (hidden: number) => string
}

/** Enough rows to pick from without turning a menu into the surface it links to. */
export const STATUS_MENU_LIST_LIMIT = 8

export function statusMenuList<T>({
  header,
  items,
  limit = STATUS_MENU_LIST_LIMIT,
  row,
  onOverflow,
  overflowLabel = (hidden) => `${hidden} more in the workspace…`,
}: StatusMenuListOptions<T>): MenuEntry[] {
  if (items.length === 0) return []

  const shown = items.slice(0, limit)
  const hidden = items.length - shown.length
  const entries: MenuEntry[] = header ? [{ header }] : []
  entries.push(...shown.map(row))

  // Truncated with nowhere to send the person is worse than not truncating: the row would be a
  // dead end. A caller without an `onOverflow` gets the full list instead.
  if (hidden > 0 && onOverflow) {
    entries.push({ id: 'status-menu:overflow', label: overflowLabel(hidden), onSelect: onOverflow })
  } else if (hidden > 0) {
    entries.push(...items.slice(limit).map(row))
  }
  return entries
}
