import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { copyText } from '@localixai/mini-app-sdk/ui/interactions'
import type { DbDialect } from '../../dbClient'
import type { DbTableOpenMode } from '../../model/openConsole'
import type { ColumnTreeRow, SchemaTreeRow, TableTreeRow } from '../../model/schemaTreeRows'
import { quoteIdent, selectTableSql } from '../../model/sqlIdent'

/** What an object row acts through — both trees supply it for their own connection(s). */
export interface ObjectMenuContext {
  dialect: DbDialect
  openTable: (table: string, uriSchema?: string, mode?: DbTableOpenMode) => void
  insertColumn: (column: string) => void
  viewDdl: (table: string, schemaArg?: string) => void
  loadTable: (table: string, schemaArg?: string) => void
  setOpen: (key: string, open: boolean) => void
}

/** Open or close an object branch; a table read its columns the moment it opens. */
export function setObjectRowOpen(row: SchemaTreeRow, open: boolean, ctx: ObjectMenuContext): void {
  ctx.setOpen(row.key, open)
  if (open && row.kind === 'table') ctx.loadTable(row.item.name, row.schemaArg)
}

/** Click / Enter: a table opens its data, a column goes into the console, a group toggles. */
export function activateObjectRow(row: SchemaTreeRow, ctx: ObjectMenuContext): void {
  if (row.kind === 'schema' || row.kind === 'group') setObjectRowOpen(row, !row.open, ctx)
  else if (row.kind === 'table') ctx.openTable(row.item.name, row.uriSchema, 'browse')
  else if (row.kind === 'column') ctx.insertColumn(row.column.name)
}

/**
 * The object rows' menus, described once as data for the tree's single context menu. They were
 * JSX inside each table node and column row — one mounted menu per row, which is most of what a
 * 5,000-table tree used to mount.
 */
export function objectMenuEntries(
  row: SchemaTreeRow,
  ctx: ObjectMenuContext,
): readonly MenuEntry[] | null {
  if (row.kind === 'table') return tableEntries(row, ctx)
  if (row.kind === 'column') return columnEntries(row, ctx)
  return null
}

function tableEntries(row: TableTreeRow, ctx: ObjectMenuContext): MenuEntry[] {
  const name = row.item.name
  return [
    {
      id: 'open',
      label: 'Open data',
      onSelect: () => ctx.openTable(name, row.uriSchema, 'browse'),
    },
    ...(row.canEditStructure
      ? [
          {
            id: 'structure',
            label: 'Edit structure',
            onSelect: () => ctx.openTable(name, row.uriSchema, 'edit-structure'),
          },
        ]
      : []),
    { separator: true },
    {
      id: 'copy-select',
      label: 'Copy SELECT',
      onSelect: () =>
        void copyText(
          selectTableSql({ table: name, schema: row.schemaArg, dialect: ctx.dialect }),
          'SELECT statement',
        ),
    },
    { id: 'copy-name', label: 'Copy name', onSelect: () => void copyText(name, 'Object name') },
    { id: 'ddl', label: 'View DDL…', onSelect: () => ctx.viewDdl(name, row.schemaArg) },
  ]
}

function columnEntries(row: ColumnTreeRow, ctx: ObjectMenuContext): MenuEntry[] {
  const name = row.column.name
  return [
    { id: 'insert', label: 'Insert into console', onSelect: () => ctx.insertColumn(name) },
    { separator: true },
    { id: 'copy-name', label: 'Copy name', onSelect: () => void copyText(name, 'Column name') },
    {
      id: 'copy-qualified',
      label: 'Copy table.column',
      onSelect: () =>
        void copyText(
          `${quoteIdent(row.table, ctx.dialect)}.${quoteIdent(name, ctx.dialect)}`,
          'Qualified column',
        ),
    },
    ...(row.refTable
      ? [
          {
            id: 'open-ref',
            label: `Open ${row.refTable}`,
            onSelect: () => ctx.openTable(row.refTable!),
          },
        ]
      : []),
  ]
}
