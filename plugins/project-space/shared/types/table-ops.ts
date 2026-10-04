import { TABLE_LIMIT, type TableProps } from './table'

export type TableColumnEdit =
  | { kind: 'rename'; index: number; title: string }
  | { kind: 'insert'; index: number }
  | { kind: 'remove'; index: number }
  | { kind: 'move'; index: number; direction: -1 | 1 }

/** Change headers and their cells together; column operations are one native undo step. */
export function editTableColumn(
  value: TableProps,
  edit: TableColumnEdit,
): Pick<TableProps, 'columns' | 'rows'> | null {
  const { columns, rows } = value
  const index = edit.index
  if (!Number.isInteger(index) || index < 0 || index > columns.length) return null
  if (edit.kind === 'insert') {
    if (columns.length >= TABLE_LIMIT.columns) return null
    let number = columns.length + 1
    while (columns.includes(`Column ${number}`)) number++
    return {
      columns: [...columns.slice(0, index), `Column ${number}`, ...columns.slice(index)],
      rows: rows.map((row) => [...row.slice(0, index), '', ...row.slice(index)]),
    }
  }
  if (index >= columns.length) return null
  if (edit.kind === 'rename') {
    const title = edit.title.trim()
    return title && title !== columns[index]
      ? { columns: columns.map((name, at) => (at === index ? title : name)), rows }
      : null
  }
  if (edit.kind === 'remove') {
    if (columns.length === 1) return null
    return {
      columns: columns.filter((_, at) => at !== index),
      rows: rows.map((row) => row.filter((_, at) => at !== index)),
    }
  }
  const to = index + edit.direction
  if (to < 0 || to >= columns.length) return null
  const swap = (cells: string[]) =>
    cells.map((cell, at) => (at === index ? cells[to]! : at === to ? cells[index]! : cell))
  return { columns: swap(columns), rows: rows.map(swap) }
}
