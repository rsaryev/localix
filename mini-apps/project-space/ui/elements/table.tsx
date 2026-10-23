import { useState } from 'react'
import { Check, Code2, StickyNote, Table2 } from 'lucide-react'
import { TableGrid, toast, type MiniAppStagedTableChanges } from '@localixai/mini-app-sdk/ui'
import { IconButton } from '@localixai/kit/icon-button'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { readTable, writeTable, TABLE_LIMIT, type TableProps } from '../../shared/types/table'
import { CardTitle } from './CardTitle'
import { CodeArea } from './CodeArea'
import { codeHighlighter } from './highlight'
import {
  editTableColumn,
  tableToNotesOps,
  type TableColumnEdit,
} from '../../shared/types/table-ops'
import { newId, takenIn } from '../../shared/format/ids'
import { defineView, type ElementViewProps } from './contract'

/** Translate the host grid's edits into native board rows, preserving original row order. */
export function tableRowsAfter(props: TableProps, changes: MiniAppStagedTableChanges): string[][] {
  const removed = new Set(changes.deletes.map((row) => Number(row.__spaceRow)))
  const updates = new Map(
    changes.updates.map((update) => [Number(update.row.__spaceRow), update.values]),
  )
  const rows = props.rows.flatMap((row, index) =>
    removed.has(index)
      ? []
      : [
          row.map((cell, column) => {
            const values = updates.get(index)
            return values && Object.hasOwn(values, `c${column}`)
              ? (values[`c${column}`] ?? '')
              : cell
          }),
        ],
  )
  return [
    ...rows,
    ...changes.inserts.map((values) => props.columns.map((_, index) => values[`c${index}`] ?? '')),
  ]
}

function TableView({ props, editing, commit, stopEditing }: ElementViewProps<TableProps>) {
  const [source, setSource] = useState(false)
  const columns = props.columns.map((title, index) => ({
    id: `c${index}`,
    title,
    type: 'text' as const,
    width: 160,
    sortable: false,
  }))
  const rows = props.rows.map((row, index) =>
    Object.fromEntries([['__spaceRow', index], ...row.map((cell, column) => [`c${column}`, cell])]),
  )
  const save = (changes: MiniAppStagedTableChanges) => {
    const next = tableRowsAfter(props, changes)
    if (next.length > TABLE_LIMIT.rows) {
      toast.error(`A table can have at most ${TABLE_LIMIT.rows} rows`)
      return
    }
    commit({ rows: next })
  }
  const changeColumn = (edit: TableColumnEdit) => {
    const next = editTableColumn(props, edit)
    if (next) commit(next)
  }
  const done = () => {
    setSource(false)
    stopEditing()
  }
  return (
    <div className="flex h-full w-full flex-col">
      <CardTitle
        Icon={Table2}
        title={props.title || 'Table'}
        actions={
          editing && (
            <>
              {!source && (
                <IconButton
                  size="xs"
                  aria-label="Edit table as Markdown"
                  tooltip="Edit as Markdown"
                  onClick={() => setSource(true)}
                >
                  <Code2 className="size-3.5" />
                </IconButton>
              )}
              <IconButton size="xs" aria-label="Finish editing table" tooltip="Done" onClick={done}>
                <Check className="size-3.5" />
              </IconButton>
            </>
          )
        }
      />
      <div className={cn('min-h-0 flex-1', editing ? 'nodrag nowheel' : 'pointer-events-none')}>
        {editing && source ? (
          <CodeArea
            value={writeTable(props)}
            highlight={codeHighlighter('markdown')}
            label="Edit the table as Markdown"
            className="p-3"
            onDone={done}
            onCommit={(text) => {
              const read = readTable(text)
              if (typeof read === 'string') toast.error(`Table: ${read}`)
              else commit(read)
            }}
          />
        ) : (
          <TableGrid
            columns={columns}
            rows={rows}
            total={rows.length}
            showColumnTypes={false}
            showColumnIcons={false}
            showRowNumbers={false}
            showCellActions={false}
            allowNullValues={false}
            columnActions={
              editing
                ? {
                    rename: (id, title) =>
                      changeColumn({ kind: 'rename', index: Number(id.slice(1)), title }),
                    insert:
                      props.columns.length < TABLE_LIMIT.columns
                        ? (id, side) =>
                            changeColumn({
                              kind: 'insert',
                              index: Number(id.slice(1)) + (side === 'after' ? 1 : 0),
                            })
                        : undefined,
                    move: (id, direction) =>
                      changeColumn({
                        kind: 'move',
                        index: Number(id.slice(1)),
                        direction: direction === 'left' ? -1 : 1,
                      }),
                    remove: (id) => changeColumn({ kind: 'remove', index: Number(id.slice(1)) }),
                  }
                : undefined
            }
            onToggleSort={() => undefined}
            onReachEnd={() => undefined}
            editable={editing}
            onCellEdit={
              editing
                ? (row, column, value) =>
                    save({
                      updates: [{ row, values: { [column]: value } }],
                      inserts: [],
                      deletes: [],
                    })
                : undefined
            }
            onAddRow={
              editing
                ? (values) => save({ updates: [], inserts: [values], deletes: [] })
                : undefined
            }
            onDeleteRow={
              editing ? (row) => save({ updates: [], inserts: [], deletes: [row] }) : undefined
            }
          />
        )}
      </div>
    </div>
  )
}

export const tableViews = [
  defineView({
    type: 'table',
    View: TableView,
    Icon: Table2,
    editable: true,
    chrome: 'card',
    insert: {
      order: 7,
      key: 'b',
      description: 'Editable cells, rows and columns; paste Markdown tables or spreadsheet cells',
    },
    actions: [
      {
        label: 'Make sticky notes',
        Icon: StickyNote,
        ops: ({ element, props, space }) => {
          const taken = takenIn(space)
          const made = new Set<string>()
          const fresh = () => {
            const id = newId((candidate) => taken(candidate) || made.has(candidate))
            made.add(id)
            return id
          }
          const ops = tableToNotesOps(element, props, fresh)
          return ops.length ? ops : null
        },
      },
    ],
  }),
]
