import type { MenuEntry } from '@localixai/plugin-sdk/ui'

/**
 * The explorer's "More options" menu — view toggles for the tree itself.
 *
 * "Compact folders" was a hand-built row: a `<Check>` that was always rendered and faded in by
 * opacity, so the toggle carried no `aria-checked` and announced itself as a plain command whose
 * state nobody could hear. It is an on/off switch, so it is a `checked` row — the one kind the
 * shared walker renders as `menuitemcheckbox` — and `keepOpen` keeps the old behaviour of
 * flipping it without closing the menu, so the change is visible in the row that made it.
 *
 * A pure builder beside `fileTreeRootMenu.ts`, so its shape is testable without mounting the
 * sidebar.
 */
export function fileTreeOptionsEntries({
  compactEnabled,
  toggleCompactEnabled,
}: {
  compactEnabled: boolean
  toggleCompactEnabled: () => void
}): MenuEntry[] {
  return [
    {
      id: 'compact-folders',
      label: 'Compact folders',
      checked: compactEnabled,
      keepOpen: true,
      onSelect: toggleCompactEnabled,
    },
  ]
}
