import { useCallback, useState } from 'react'
import { isBranch, isTreeItem, type IsOpen, type SchemaTreeRow } from './schemaTreeRows'

export type SchemaTreeNavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

export type SchemaTreeNavigation = { kind: 'focus'; key: string } | { kind: 'toggle'; key: string }

export const isSchemaTreeNavKey = (key: string): key is SchemaTreeNavKey =>
  key === 'ArrowUp' ||
  key === 'ArrowDown' ||
  key === 'ArrowLeft' ||
  key === 'ArrowRight' ||
  key === 'Home' ||
  key === 'End'

/**
 * Resolve arrow/Home/End movement from the flat MODEL, not the mounted DOM.
 *
 * The kit's `treeNavKeyDown` walks `[data-tree-path]` elements, which is right for a fully mounted
 * tree and wrong for a windowed one: End would land on the last MOUNTED row, and ArrowDown from a
 * row pinned outside the window would jump to the window's first row. The host's virtual Files
 * tree resolves navigation from its row model for the same reason; this is that rule for schema
 * rows. Status and label rows are not treeitems and are never visited.
 */
export function schemaTreeNavigation(
  rows: readonly SchemaTreeRow[],
  currentKey: string,
  key: SchemaTreeNavKey,
): SchemaTreeNavigation | null {
  const items = rows.filter(isTreeItem)
  const index = items.findIndex((row) => row.key === currentKey)
  if (index < 0) return null
  const current = items[index]!
  if (key === 'Home' || key === 'End') {
    const target = items[key === 'Home' ? 0 : items.length - 1]
    return target ? { kind: 'focus', key: target.key } : null
  }
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const target = items[index + (key === 'ArrowDown' ? 1 : -1)]
    return target ? { kind: 'focus', key: target.key } : null
  }
  if (key === 'ArrowRight') {
    if (!isBranch(current)) return null
    if (!current.open) return { kind: 'toggle', key: current.key }
    const child = items[index + 1]
    return child && child.depth > current.depth ? { kind: 'focus', key: child.key } : null
  }
  if (isBranch(current) && current.open) return { kind: 'toggle', key: current.key }
  for (let parent = index - 1; parent >= 0; parent--) {
    if (items[parent]!.depth < current.depth) return { kind: 'focus', key: items[parent]!.key }
  }
  return null
}

/**
 * Open/closed state for every branch as ONE map of the choices the person made; a branch nobody
 * touched takes its default. Nested components each held their own `useState`, so "collapse all"
 * had to broadcast a nonce and a collapsed group forgot itself when its parent unmounted. The
 * CHOICE is stored, not a flip: a flip on a search-opened table would invert into "open" the
 * moment the search cleared and the default went back to closed.
 */
export function useTreeToggles(): {
  isOpen: IsOpen
  setOpen: (key: string, open: boolean) => void
  reset: () => void
} {
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const isOpen = useCallback<IsOpen>((key, defaultOpen) => chosen.get(key) ?? defaultOpen, [chosen])
  const setOpen = useCallback((key: string, open: boolean) => {
    setChosen((current) => new Map(current).set(key, open))
  }, [])
  const reset = useCallback(() => setChosen(new Map()), [])
  return { isOpen, setOpen, reset }
}
