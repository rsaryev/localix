import { useMemo } from 'react'
import type { VisibleRow } from './fileTreePaths'
import {
  fileTreeEntryRows,
  flattenFileTreeRows,
  type FileTreeRow,
  type FlattenFileTreeRowsInput,
} from './fileTreeRows'

/** True when the whole layout is the root's single "empty folder" status row. */
export function isRootEmptyLayout(rows: readonly FileTreeRow[]): boolean {
  const first = rows[0]
  return (
    rows.length === 1 && first?.kind === 'status' && first.status === 'empty' && first.depth === 0
  )
}

/** Layout index of every entry row, keyed by path. */
export function layoutIndexes(rows: readonly FileTreeRow[]): Map<string, number> {
  const indexes = new Map<string, number>()
  rows.forEach((row, index) => {
    if (row.kind === 'entry') indexes.set(row.path, index)
  })
  return indexes
}

type LayoutInput = Omit<FlattenFileTreeRowsInput, 'root'> & { root: string | null }

/**
 * One flat layout is authoritative for render order and every interaction that
 * used to query all mounted DOM rows. That is what makes bounded rendering safe:
 * rows outside the viewport remain navigable, revealable, and range-selectable.
 */
export function useFileTreeLayout({
  root,
  childrenByPath,
  truncatedByPath,
  expanded,
  loading,
  edit,
  filter,
  compactEnabled,
}: LayoutInput) {
  const rows = useMemo(
    () =>
      root
        ? flattenFileTreeRows({
            root,
            childrenByPath,
            truncatedByPath,
            expanded,
            loading,
            edit,
            filter,
            compactEnabled,
          })
        : [],
    [root, childrenByPath, truncatedByPath, expanded, loading, edit, filter, compactEnabled],
  )
  const entryRows = useMemo(() => fileTreeEntryRows(rows), [rows])
  const entryOrder = useMemo<VisibleRow[]>(
    () => entryRows.map(({ path, name, type }) => ({ path, name, type })),
    [entryRows],
  )
  const layoutIndexByPath = useMemo(() => layoutIndexes(rows), [rows])
  return { rows, entryRows, entryOrder, layoutIndexByPath, rootIsEmpty: isRootEmptyLayout(rows) }
}
