import type {
  MenuActionEntry,
  MenuEntry,
  MenuHeaderEntry,
  MenuSeparatorEntry,
  MenuSubmenuEntry,
} from '@localixai/mini-app-sdk/ui'

/**
 * The pure half of a described menu: what its rows MEAN, before anything renders them.
 *
 * Menus in this app are built by spreading live data into a literal —
 * `[open, { separator: true }, ...rows, { separator: true }, ...actions]` — and the host then
 * appends its own `Mini app settings…` behind one more separator. Every one of those spreads can be
 * empty, and each empty one leaves a seam the author never wrote: a rule against the panel's top
 * edge, two rules with nothing between them, a rule hanging under the last row. Ten mini apps build
 * their menus that way and every one of them had at least one.
 *
 * Fixing that at each call site is ten fixes and a rule nobody can enforce. Fixing it here is one,
 * and it makes the empty case something a mini app author is allowed to stop thinking about.
 *
 * Pure, so the whole decision is unit-testable without a DOM; {@link MenuEntries} renders it.
 */

export function isMenuSeparator(entry: MenuEntry): entry is MenuSeparatorEntry {
  return 'separator' in entry
}

export function isMenuHeader(entry: MenuEntry): entry is MenuHeaderEntry {
  return 'header' in entry
}

export function isMenuSubmenu(entry: MenuEntry): entry is MenuSubmenuEntry {
  return 'items' in entry
}

export function isMenuAction(entry: MenuEntry): entry is MenuActionEntry {
  return !isMenuSeparator(entry) && !isMenuHeader(entry) && !isMenuSubmenu(entry)
}

/**
 * Drop the seams a spread leaves behind, at every level.
 *
 * Four rules, each one a defect seen in the bundled set:
 *   - a separator against the top edge, or the bottom, is a rule dividing nothing;
 *   - two separators in a row are one rule and a gap;
 *   - a header directly above a rule is a title for the group on the other side of it;
 *   - a header with nothing under it names an empty set.
 *
 * Submenus are normalised first so an inner level that collapses to nothing is visible to the
 * outer one as the empty group it now is.
 */
export function normalizeMenuEntries(entries: readonly MenuEntry[]): MenuEntry[] {
  const walked = entries.map((entry) =>
    isMenuSubmenu(entry) ? { ...entry, items: normalizeMenuEntries(entry.items) } : entry,
  )

  const out: MenuEntry[] = []
  for (const entry of walked) {
    const previous = out.at(-1)
    if (isMenuSeparator(entry)) {
      // Nothing above it, a rule above it, or a title above it: in all three the rule divides
      // nothing, and in the last one it would strand the title from the rows it names.
      if (!previous || isMenuSeparator(previous) || isMenuHeader(previous)) continue
      out.push(entry)
      continue
    }
    if (isMenuHeader(entry)) {
      // A header the previous pass has just proven empty — its group turned out to have no rows.
      while (out.length > 0 && isMenuHeader(out.at(-1)!)) out.pop()
      out.push(entry)
      continue
    }
    out.push(entry)
  }

  while (out.length > 0) {
    const last = out.at(-1)!
    if (!isMenuSeparator(last) && !isMenuHeader(last)) break
    out.pop()
  }
  return out
}

/**
 * Whether one LEVEL reserves the leading column an icon sits in.
 *
 * Every native menu aligns a level's labels on one column: if anything in the
 * list carries an icon, everything in it is indented, so choosing between two rows is a vertical
 * scan rather than a hunt. Deciding it per row instead — which is what rendering each entry on its
 * own gives you — produces the ragged left edge these menus had, where `Fetch` sat two characters
 * left of the branch with an icon above it.
 *
 * Per level, not per menu: a submenu is its own list, read on its own, and inheriting a parent's
 * indent would leave every row in it pushed right for a mark that lives in another panel.
 */
export function menuLevelNeedsGutter(entries: readonly MenuEntry[]): boolean {
  // Only an icon claims the leading column: `checked` and `selected` rows put their check at the
  // END, so a level of bare choices stays on the text edge like a level of bare actions.
  return entries.some(
    (entry) => (isMenuAction(entry) || isMenuSubmenu(entry)) && Boolean(entry.icon),
  )
}
