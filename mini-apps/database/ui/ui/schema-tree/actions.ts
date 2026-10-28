import { useMemo } from 'react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import type { ColumnTreeRow, SchemaTreeRow, StatusTreeRow } from '../../model/schemaTreeRows'
import { useLatest } from '@localixai/mini-app-sdk/ui/runtime-hooks'

/**
 * Everything a row can ask its tree to do. Rows receive ONE stable object (see
 * {@link useStableActions}); per-row inline closures are what made every row a new prop set on
 * every render and defeated memo.
 */
export interface SchemaTreeActions {
  /** Open or close a branch; opening a table also reads its columns. */
  setOpen: (row: SchemaTreeRow, open: boolean) => void
  /** Click or Enter on a treeitem: open a connection/table, insert a column, toggle a group. */
  activate: (row: SchemaTreeRow) => void
  /** A column's foreign-key jump. */
  openRef: (row: ColumnTreeRow) => void
  /** Retry a failed per-object read. */
  retryColumns: (row: StatusTreeRow) => void
  /** The one delegated context menu's entries for a row; null = no menu. */
  menuFor: (row: SchemaTreeRow) => readonly MenuEntry[] | null
  createTable?: (connectionId: string, schemaName: string) => void
  newConsole?: (connectionId: string) => void
  renameChange?: (connectionId: string, draft: string) => void
  renameCommit?: () => void
  renameCancel?: () => void
}

/**
 * A referentially stable facade over the latest implementation. Rows only CALL actions (at event
 * time, after commit), so reading through a ref is always current, and the facade never changes
 * identity — which is what lets a memoized row skip a render its data did not cause.
 */
export function useStableActions<T extends object>(impl: T): T {
  const latest = useLatest(impl)
  return useMemo(
    () =>
      new Proxy({} as T, {
        get(_target, key) {
          const value = (latest.current as Record<PropertyKey, unknown>)[key]
          return typeof value === 'function'
            ? (...args: unknown[]) =>
                (
                  (latest.current as Record<PropertyKey, unknown>)[key] as (
                    ...a: unknown[]
                  ) => unknown
                )(...args)
            : value
        },
      }),
    [latest],
  )
}
