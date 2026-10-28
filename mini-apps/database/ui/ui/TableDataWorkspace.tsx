import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'

import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { PanelHeader } from '@localixai/kit/panel-header'
import { RefreshAction } from '@localixai/kit/refresh-action'
import type { DbConnectionInfo } from '../dbClient'
import { DATABASE_DRIVER_CATALOG } from '../../shared/driver-catalog'
import type { DbTableOpenMode } from '../model/openConsole'
import type { RowEditTarget } from '../model/rowMutations'
import type { SchemaState } from '../model/useSchema'
import { useDbProblem } from '../problems'
import { ExportMenu } from './sql-console/ExportMenu'
import { useRowEditing } from './sql-console/useRowEditing'
import { useObjectProblem } from './ObjectErrorState'
import { DataView } from './table-data/DataView'
import { DdlView } from './table-data/DdlView'
import { StructureView } from './table-data/StructureView'
import type { DatabaseObjectTarget } from './table-data/target'
import { useBrowsePage } from './table-data/useBrowsePage'

export type { DatabaseObjectTarget } from './table-data/target'

type ObjectView = 'data' | 'structure' | 'ddl'
const VIEWS: Array<[ObjectView, string]> = [
  ['data', 'Data'],
  ['structure', 'Structure'],
  ['ddl', 'DDL'],
]

/** Bounded object data + structure surface inside Database Workspace. */
export function TableDataWorkspace({
  connection,
  target,
  schema,
  requestedMode,
  requestNonce,
  onClose,
  onOpenConsole,
  onOpenConsoleWithSql,
  publishMessageContext,
}: {
  connection: DbConnectionInfo
  target: DatabaseObjectTarget
  schema: SchemaState
  requestedMode?: DbTableOpenMode
  requestNonce?: string
  /** The tab's live-context slot: the visible page reaches the chat without a drag. */
  publishMessageContext?: PublishMessageContext
  /** Present only when the table is nested in another surface; a table work-item tab
   * owns its own close affordance in the editor-grid tab strip. */
  onClose?: () => void
  onOpenConsole: () => void
  onOpenConsoleWithSql: (sql: string) => void
}) {
  const workItemVisible = useWorkItemVisible()
  const [view, setView] = useState<ObjectView>('data')
  const browse = useBrowsePage({
    connection,
    target,
    visible: workItemVisible,
    publishMessageContext,
  })
  const { refresh, result } = browse
  const { getTable, loadTable, reloadTable } = schema
  const tableSchema = getTable(target.table, target.schema)
  const editTarget = useMemo<RowEditTarget | undefined>(() => {
    if (
      connection.readonly ||
      !DATABASE_DRIVER_CATALOG[connection.dialect].capabilities.rowEditing ||
      tableSchema?.type !== 'table'
    )
      return undefined
    return {
      connectionId: connection.id,
      table: target.table,
      schema: target.schema,
      dialect: connection.dialect,
      pk: tableSchema.primaryKey,
      onCommitted: refresh,
    }
  }, [
    connection.id,
    connection.readonly,
    connection.dialect,
    target.table,
    target.schema,
    tableSchema,
    refresh,
  ])
  const rowEditing = useRowEditing({
    edit: editTarget,
    result,
    setSql: onOpenConsoleWithSql,
  })
  const { setEditError, commitChanges, importCsv } = rowEditing
  // ONE owner for the object's introspection failure, above both views that render it: Structure
  // and DDL each showed it only in their failing branch, so the Event Center row outlived the fix.
  const readProblem = useObjectProblem(
    `${target.schema ? `${target.schema}.` : ''}${target.table} structure`,
    schema.getTableError(target.table, target.schema),
    () => reloadTable(target.table, target.schema),
    { detail: schema.getTableErrorDetail(target.table, target.schema) },
  )
  const editProblem = useDbProblem(connection.name, rowEditing.editError, {
    consequence: 'none',
    // Dismissing is only meaningful while looking at the strip; the centre row settles itself.
    actions: [{ id: 'dismiss', label: 'Dismiss', run: () => setEditError(null), durable: false }],
  })

  // A new request (also the first one) picks the view while rendering, not in an effect.
  const [appliedRequest, setAppliedRequest] = useState<{ nonce?: string; mode?: DbTableOpenMode }>(
    {},
  )
  if (appliedRequest.nonce !== requestNonce || appliedRequest.mode !== requestedMode) {
    setAppliedRequest({ nonce: requestNonce, mode: requestedMode })
    if (requestNonce) setView(requestedMode === 'edit-structure' ? 'structure' : 'data')
  }

  useEffect(() => {
    setEditError(null)
    loadTable(target.table, target.schema)
  }, [connection.id, target.table, target.schema, loadTable, setEditError])

  const pkColumns = useMemo(() => {
    if (!result || !editTarget) return undefined
    const ids = result.columns.flatMap((column) =>
      editTarget.pk.includes(column.title) ? [column.id] : [],
    )
    return ids.length > 0 ? new Set(ids) : undefined
  }, [result, editTarget])

  // No ground coat: the hosting pane already paints one, and under the host's macOS glass theme
  // the ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      {/* The kit header, not a local `h-11` row: the explorer's connection pane beside this tab
          closes its header on the panel-header height token, and a hand-measured row stepped the
          baseline between the two. */}
      <PanelHeader
        tone="content"
        title={
          <div className="flex min-w-0 items-center gap-2">
            {onClose && (
              <IconButton
                size="sm"
                tooltip="Back to connection"
                aria-label="Back to connection"
                onClick={onClose}
              >
                <ArrowLeft className="size-3.5" />
              </IconButton>
            )}
            <span className="truncate text-xs font-semibold text-foreground">{target.table}</span>
            <span className="truncate text-2xs text-text-faint">
              {target.schema ? `${target.schema} · ` : ''}
              {connection.name}
            </span>
          </div>
        }
        actionsLabel="Object actions"
        actions={
          <>
            <SegmentedControl variant="muted" aria-label="Database object view">
              {VIEWS.map(([id, label]) => (
                <SegmentedControlItem key={id} active={view === id} onClick={() => setView(id)}>
                  {label}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
            <RefreshAction
              size="sm"
              tooltip="Refresh data"
              aria-label="Refresh data"
              onClick={() => {
                if (view === 'structure' || view === 'ddl') reloadTable(target.table, target.schema)
                else refresh()
              }}
              busy={browse.loading && view === 'data'}
            />
            {view === 'data' && (result || editTarget) && (
              <ExportMenu
                rows={browse.visibleRows}
                result={result}
                edit={editTarget}
                onImportCsv={importCsv}
              />
            )}
            <Button size="xs" variant="ghost" onClick={onOpenConsole}>
              <ArrowUpRight className="size-3" />
              Console
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1">
        {/* HIDDEN, not unmounted. `StructureView` owns the pending column edits, and unmounting it on a
            view switch destroyed them — so clicking Data and back silently discarded staged work the
            header had just promised would keep ("Changes stay staged until you review the SQL"). It costs
            no extra fetch: this workspace loads the table's schema for every view anyway, and the same
            hide-don't-unmount rule already governs the section tabs inside it. */}
        <div className={view === 'structure' ? 'h-full min-h-0' : 'hidden'}>
          <StructureView
            connection={connection}
            target={target}
            schema={schema}
            readProblem={readProblem}
            onOpenConsoleWithSql={onOpenConsoleWithSql}
          />
        </div>
        {/* Only STRUCTURE is kept alive above — it is the one view holding unsaved user state. DDL and
            Data stay unmount-on-leave: the data grid deliberately remounts per scope (`dataScopeKey`),
            and the page it shows survives in `useBrowsePage`, so coming back does not re-read it. */}
        {view === 'ddl' ? (
          <DdlView
            connection={connection}
            target={target}
            schema={schema}
            readProblem={readProblem}
            onOpenConsoleWithSql={onOpenConsoleWithSql}
          />
        ) : view === 'data' ? (
          <DataView
            connection={connection}
            browse={browse}
            editTarget={editTarget}
            pkColumns={pkColumns}
            commitChanges={commitChanges}
            editProblem={editProblem}
          />
        ) : null}
      </div>
    </main>
  )
}
