import type { SpaceOp } from '../ops/contract'
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

/** The palette a column of notes takes, in order: one colour per column, so columns stay legible. */
const COLUMN_COLORS = ['yellow', 'blue', 'green', 'pink', 'purple', 'orange'] as const
const NOTE = 160
const NOTE_GAP = 24

/**
 * A table's cells as sticky notes beside it, as a whiteboard's "paste as sticky notes": one note
 * per filled cell, each table column a column of notes in its own colour under its header. The
 * table stays; the notes are new and grouped, so they move away as one to be sorted.
 */
export function tableToNotesOps(
  element: { x: number; y: number; w: number },
  table: { columns: readonly string[]; rows: readonly (readonly string[])[] },
  newId: () => string,
): SpaceOp[] {
  const left = element.x + element.w + 80
  const created: string[] = []
  const ops: SpaceOp[] = []
  table.columns.forEach((header, column) => {
    const x = left + column * (NOTE + NOTE_GAP)
    const color = COLUMN_COLORS[column % COLUMN_COLORS.length]
    let row = 0
    const place = (text: string, bold: boolean) => {
      const id = newId()
      created.push(id)
      ops.push({
        op: 'create',
        id,
        type: 'note',
        x,
        y: element.y + row++ * (NOTE + NOTE_GAP),
        w: NOTE,
        h: NOTE,
        text: bold ? `**${text}**` : text,
        props: { color },
      })
    }
    if (header.trim()) place(header.trim(), true)
    for (const cells of table.rows) if (cells[column]?.trim()) place(cells[column]!.trim(), false)
  })
  return created.length >= 2 ? [...ops, { op: 'group', ids: created }] : ops
}
