import { useMemo, useState } from 'react'
import { Columns3 } from 'lucide-react'
import type { DbConnectionInfo } from '../dbClient'
import type { DbTableOpenMode } from '../model/openConsole'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ProblemLine } from '@localixai/mini-app-sdk/ui/components'
import { IconButton } from '@localixai/kit/icon-button'
import { SearchInput } from '@localixai/kit/search-input'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { canEditSchema } from '../model/connectionTreeRows'
import { fetchSchemaDump } from '../model/exportSchema'
import { downloadTextFile } from '../model/download'
import { useTreeToggles } from '../model/schemaTreeNavigation'
import { pushObjectRows, type SchemaTreeRow } from '../model/schemaTreeRows'
import type { SchemaState } from '../model/useSchema'
import { useDbProblem } from '../problems'
import { DdlPreviewDialog, useDdlTarget } from './schema-tree/DdlPreviewDialog'
import { useStableActions, type SchemaTreeActions } from './schema-tree/actions'
import {
  activateObjectRow,
  objectMenuEntries,
  setObjectRowOpen,
  type ObjectMenuContext,
} from './schema-tree/objectRowActions'
import { SchemaTree } from './schema-tree/SchemaTree'
import { SidebarHeader } from './schema-sidebar/SidebarHeader'
import { useSchemaFilter } from './schema-sidebar/useSchemaFilter'

/**
 * Schema tree for ONE connection: schemas → tables/views → columns (lazy), windowed. A table row
 * opens its directly editable data; its chevron alone expands metadata. Structure editing remains
 * explicit because it is a separate table-level workflow.
 */
export function SchemaSidebar({
  connection,
  schema,
  onOpenTable,
  onInsertColumn,
  width,
}: {
  connection: DbConnectionInfo
  schema: SchemaState
  onOpenTable: (table: string, schema?: string, mode?: DbTableOpenMode) => void
  onInsertColumn: (column: string) => void
  /** Explicit width (px) when the pane is user-resizable; falls back to a default. */
  width?: number
}) {
  const filter = useSchemaFilter(schema)
  const { groups, single, searchActive, filtered, totalTables } = filter
  const schemaProblem = useDbProblem(`${connection.name} schema`, schema.error, {
    detail: schema.errorDetail ?? undefined,
    actions: [{ id: 'retry', label: 'Retry', run: schema.reload }],
  })
  const toggles = useTreeToggles()
  const ddl = useDdlTarget()

  // Keyed on the readers, never on `schema` itself: that object is new on every render, which is
  // how the old tree re-rendered every row on every keystroke and store commit.
  const { getTable, getTableError } = schema
  const rows = useMemo(() => {
    const out: SchemaTreeRow[] = []
    pushObjectRows(out, {
      connection,
      reader: { getTable, getTableError },
      groups: filtered,
      baseDepth: 0,
      schemaRows: 'multi',
      schemaDefaultOpen: true,
      searchActive,
      canEditSchema: canEditSchema(connection),
      isOpen: toggles.isOpen,
    })
    return out
  }, [connection, getTable, getTableError, filtered, searchActive, toggles.isOpen])

  const ctx: ObjectMenuContext = {
    dialect: connection.dialect,
    openTable: onOpenTable,
    insertColumn: onInsertColumn,
    viewDdl: (table, schemaArg) => {
      schema.loadTable(table, schemaArg)
      ddl.open({ connectionId: connection.id, table, schema: schemaArg })
    },
    loadTable: schema.loadTable,
    setOpen: toggles.setOpen,
  }
  const actions = useStableActions<SchemaTreeActions>({
    setOpen: (row, open) => setObjectRowOpen(row, open, ctx),
    activate: (row) => activateObjectRow(row, ctx),
    openRef: (row) => {
      if (row.refTable) onOpenTable(row.refTable)
    },
    retryColumns: (row) => {
      if (row.table) schema.reloadTable(row.table, row.schemaArg)
    },
    menuFor: (row) => objectMenuEntries(row, ctx),
  })

  // Dump the whole connection's schema (every table's CREATE + indexes) to a .sql file.
  const [dumping, setDumping] = useState(false)
  const exportSchema = async () => {
    if (dumping || totalTables === 0) return
    setDumping(true)
    try {
      const entries = groups.flatMap(([schemaName, items]) =>
        items.map((i) => ({ name: i.name, schema: single ? undefined : schemaName })),
      )
      const sql = await fetchSchemaDump(connection.id, entries, connection.dialect)
      downloadTextFile(`${connection.name}-schema.sql`, 'application/sql', sql)
    } finally {
      setDumping(false)
    }
  }

  return (
    <>
      <div
        className={cn(
          // No fill at all: this FILLS a pane in both of its shapes below, and a pane inherits the
          // ground of the pane it is mounted into; the seam belongs to the border-r, not a coat.
          'flex h-full min-h-0 flex-col',
          // Explicit width → a fixed, resizable pane (workbench split). No width → fill.
          width != null ? 'shrink-0 border-r border-border' : 'w-full',
        )}
        style={width != null ? { width } : undefined}
      >
        <SidebarHeader
          label="Objects"
          totalTables={totalTables}
          dumping={dumping}
          onExport={() => void exportSchema()}
          loading={schema.loading}
          onReload={schema.reload}
        />
        {totalTables > 0 && (
          <div className="flex shrink-0 items-center gap-1 px-1.5 pb-1">
            <SearchInput
              value={filter.filter}
              onValueChange={filter.setFilter}
              placeholder={filter.searchColumns ? 'Filter tables and columns…' : 'Filter tables…'}
              size="md"
              className="min-w-0 flex-1"
            />
            <IconButton
              size="sm"
              aria-pressed={filter.searchColumns}
              aria-label="Also match column names"
              tooltip={
                filter.columnSearchScope < totalTables
                  ? `Also match column names (reads the first ${filter.columnSearchScope.toLocaleString()} of ${totalTables.toLocaleString()} tables)`
                  : 'Also match column names'
              }
              className={filter.searchColumns ? 'text-foreground' : undefined}
              onClick={() => filter.setSearchColumns(!filter.searchColumns)}
            >
              <Columns3 className="size-3.5" />
            </IconButton>
          </div>
        )}
        {schemaProblem ? (
          <ProblemLine {...schemaProblem} className="px-2 py-2" />
        ) : schema.loading && !schema.schemas ? (
          <LoadingHint className="p-2 text-2xs">Loading schema…</LoadingHint>
        ) : groups.length === 0 ? (
          <EmptyHint className="p-2 text-2xs">No tables.</EmptyHint>
        ) : filtered.length === 0 ? (
          <EmptyHint className="p-2 text-2xs">No matches for “{filter.filter.trim()}”.</EmptyHint>
        ) : (
          <SchemaTree rows={rows} actions={actions} ariaLabel={`${connection.name} objects`} />
        )}
      </div>
      <DdlPreviewDialog
        target={ddl.target}
        reader={schema}
        dialect={connection.dialect}
        onClose={ddl.close}
      />
    </>
  )
}
