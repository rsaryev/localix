import type { MiniAppProblemLineProps } from '@localixai/mini-app-sdk/ui/components'
import type { DbColumn, DbConnectionInfo, DbIndex, DbSchemaItem } from '../dbClient'
import type { SchemaItemMatch, SchemaMatchReason } from './schemaSearch'
import type { SchemaState } from './useSchema'

/**
 * The schema tree as ONE flat, top-to-bottom row list — the shape the host's Files tree uses
 * (`fileTreeRows.ts`), for the same reason.
 *
 * The defect it replaces: the tree was nested components (connection → schema → group → table
 * node → column row), each mounting its own context menu, with every row re-rendered by every
 * store commit because inline closures and a fresh `schema` object defeated memo. A connection
 * with 5,000 tables mounted 5,000 table nodes and 5,000 menus before the first paint. Flat rows
 * are what a virtualizer windows, what keyboard navigation walks without the DOM, and what one
 * delegated context menu resolves by key.
 */

/** What a row needs from a connection's schema — `SchemaState` satisfies it. */
export type SchemaReader = Pick<
  SchemaState,
  | 'schemas'
  | 'loading'
  | 'error'
  | 'errorDetail'
  | 'reload'
  | 'getTable'
  | 'getTableError'
  | 'getTableErrorDetail'
  | 'loadTable'
  | 'reloadTable'
>

interface RowBase {
  key: string
  depth: number
  connectionId: string
}

export interface ConnectionTreeRow extends RowBase {
  kind: 'connection'
  connection: DbConnectionInfo
  open: boolean
  /** The inline rename draft while this connection is being renamed. */
  renameDraft: string | null
  reconnecting: boolean
}
export interface SchemaTreeSchemaRow extends RowBase {
  kind: 'schema'
  schemaName: string
  count: number
  open: boolean
  canCreateTable: boolean
}
export interface GroupTreeRow extends RowBase {
  kind: 'group'
  group: 'tables' | 'views'
  count: number
  open: boolean
}
export interface TableTreeRow extends RowBase {
  kind: 'table'
  item: DbSchemaItem
  /** Schema argument for reads: undefined when the connection has one namespace. */
  schemaArg?: string
  /** The real schema name, for resource URIs and opening the data tab. */
  uriSchema: string
  open: boolean
  matchReason: SchemaMatchReason
  matchedColumns: readonly string[]
  approxRows?: number
  canEditStructure: boolean
}
export interface ColumnTreeRow extends RowBase {
  kind: 'column'
  column: DbColumn
  table: string
  schemaArg?: string
  uriSchema: string
  refTable?: string
  isMatch: boolean
}
export interface IndexLabelTreeRow extends RowBase {
  kind: 'index-label'
}
export interface IndexTreeRow extends RowBase {
  kind: 'index'
  index: DbIndex
}
export type TreeStatus =
  | 'connecting'
  | 'disconnected'
  | 'loading'
  | 'no-objects'
  | 'empty'
  | 'columns-loading'
  | 'columns-error'
  | 'problem'
export interface StatusTreeRow extends RowBase {
  kind: 'status'
  status: TreeStatus
  /** `columns-error`: the reason, and the object to re-read. */
  message?: string
  table?: string
  schemaArg?: string
  /** `problem`: the owned report to render (null until its owner has published it). */
  line?: MiniAppProblemLineProps | null
}

export type SchemaTreeRow =
  | ConnectionTreeRow
  | SchemaTreeSchemaRow
  | GroupTreeRow
  | TableTreeRow
  | ColumnTreeRow
  | IndexLabelTreeRow
  | IndexTreeRow
  | StatusTreeRow

/** Rows that are ARIA treeitems — what keyboard navigation and roving focus visit. */
export const isTreeItem = (row: SchemaTreeRow): boolean =>
  row.kind !== 'status' && row.kind !== 'index-label'

/** Rows that open and close. */
export const isBranch = (
  row: SchemaTreeRow,
): row is ConnectionTreeRow | SchemaTreeSchemaRow | GroupTreeRow | TableTreeRow =>
  row.kind === 'connection' || row.kind === 'schema' || row.kind === 'group' || row.kind === 'table'

export const treeKey = (...parts: ReadonlyArray<string | undefined>): string =>
  JSON.stringify(parts)

/** Whether a branch is open: its default, flipped when the person toggled it. */
export type IsOpen = (key: string, defaultOpen: boolean) => boolean

export interface ObjectRowsInput {
  connection: DbConnectionInfo
  reader: Pick<SchemaReader, 'getTable' | 'getTableError'>
  groups: ReadonlyArray<readonly [string, readonly SchemaItemMatch[]]>
  baseDepth: number
  /** `always`: a schema row even for one namespace (the connections tree); `multi`: only for several. */
  schemaRows: 'always' | 'multi'
  /** Default for a schema row. */
  schemaDefaultOpen: boolean
  searchActive: boolean
  canEditSchema: boolean
  isOpen: IsOpen
}

/** Append one connection's objects: schema → Tables/Views → object → columns + indexes. */
export function pushObjectRows(rows: SchemaTreeRow[], input: ObjectRowsInput): void {
  const { connection, groups } = input
  const connectionId = connection.id
  const single = groups.length === 1
  for (const [schemaName, matches] of groups) {
    let depth = input.baseDepth
    if (input.schemaRows === 'always' || !single) {
      const key = treeKey(connectionId, 's', schemaName)
      const open = input.isOpen(key, input.schemaDefaultOpen)
      rows.push({
        kind: 'schema',
        key,
        depth,
        connectionId,
        schemaName,
        count: matches.length,
        open,
        canCreateTable: input.canEditSchema,
      })
      if (!open) continue
      depth += 1
    }
    if (matches.length === 0) {
      rows.push({
        kind: 'status',
        key: treeKey(connectionId, 'e', schemaName),
        depth,
        connectionId,
        status: 'empty',
      })
      continue
    }
    const schemaArg = single ? undefined : schemaName
    for (const group of ['tables', 'views'] as const) {
      const members = matches.filter((m) => (m.item.type === 'view') === (group === 'views'))
      if (members.length === 0) continue
      const groupKey = treeKey(connectionId, 'g', schemaName, group)
      const groupOpen = input.isOpen(groupKey, true)
      rows.push({
        kind: 'group',
        key: groupKey,
        depth,
        connectionId,
        group,
        count: members.length,
        open: groupOpen,
      })
      if (!groupOpen) continue
      for (const match of members)
        pushTableRows(rows, input, match, schemaName, schemaArg, depth + 1)
    }
  }
}

function pushTableRows(
  rows: SchemaTreeRow[],
  input: ObjectRowsInput,
  match: SchemaItemMatch,
  uriSchema: string,
  schemaArg: string | undefined,
  depth: number,
): void {
  const connectionId = input.connection.id
  const { item } = match
  const key = treeKey(connectionId, 't', uriSchema, item.name)
  // A table whose COLUMNS matched opens by itself so the search reveals them.
  const autoOpen = input.searchActive && match.matchedColumns.length > 0
  const open = input.isOpen(key, autoOpen)
  const table = input.reader.getTable(item.name, schemaArg)
  rows.push({
    kind: 'table',
    key,
    depth,
    connectionId,
    item,
    schemaArg,
    uriSchema,
    open,
    matchReason: match.reason,
    matchedColumns: match.matchedColumns,
    approxRows: table?.approxRows,
    canEditStructure: item.type === 'table' && input.canEditSchema,
  })
  if (!open) return
  const childDepth = depth + 1
  if (!table) {
    const message = input.reader.getTableError(item.name, schemaArg)
    rows.push({
      kind: 'status',
      key: treeKey(connectionId, 'c?', uriSchema, item.name),
      depth: childDepth,
      connectionId,
      // A failed read is a dead end, not a slow one: it offers a retry, never a spinner.
      status: message ? 'columns-error' : 'columns-loading',
      message,
      table: item.name,
      schemaArg,
    })
    return
  }
  const refByColumn = new Map<string, string>()
  for (const fk of table.foreignKeys)
    for (const column of fk.columns)
      if (!refByColumn.has(column)) refByColumn.set(column, fk.refTable)
  const matched = match.matchedColumns.length > 0 ? new Set(match.matchedColumns) : null
  for (const column of table.columns) {
    rows.push({
      kind: 'column',
      key: treeKey(connectionId, 'c', uriSchema, item.name, column.name),
      depth: childDepth,
      connectionId,
      column,
      table: item.name,
      schemaArg,
      uriSchema,
      refTable: refByColumn.get(column.name),
      isMatch: matched?.has(column.name) ?? false,
    })
  }
  if (table.indexes.length === 0) return
  rows.push({
    kind: 'index-label',
    key: treeKey(connectionId, 'il', uriSchema, item.name),
    depth: childDepth,
    connectionId,
  })
  for (const index of table.indexes) {
    rows.push({
      kind: 'index',
      key: treeKey(connectionId, 'i', uriSchema, item.name, index.name),
      depth: childDepth,
      connectionId,
      index,
    })
  }
}
