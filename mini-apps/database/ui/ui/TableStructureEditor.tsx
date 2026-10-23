/** Base/current structure editor: every input edits an in-memory draft (`useStructureDraft`); the
 * generated dialect script is reviewed in Monaco and only then applied or opened in a console. */
import { useState } from 'react'
import { AlertCircle, Eye, Plus, RotateCcw } from 'lucide-react'
import { ProblemLine } from '@localixai/mini-app-sdk/ui/components'
import { Button } from '@localixai/kit/button'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import type { DbConnectionInfo, DbTableSchema } from '../dbClient'
import { useDbProblem } from '../problems'
import { SqlPreviewDialog } from './SqlPreviewDialog'
import { StructureRow } from './structure-editor/StructureRow'
import { useStructureDraft } from './structure-editor/useStructureDraft'
import { StructureTable } from './table-data/StructureTable'

const EDITOR_COLUMNS = [
  { label: 'Name', width: 'w-[29%]' },
  { label: 'Data type', width: 'w-[22%]', className: 'px-2 py-2' },
  { label: 'Nullable', width: 'w-[10%]', className: 'px-2 py-2 text-center' },
  { label: 'Default SQL', width: 'w-[24%]', className: 'px-2 py-2' },
  { label: 'Status', width: 'w-[10%]', className: 'px-2 py-2' },
  { label: null, width: 'w-[5%]', className: '', ariaLabel: 'Actions' },
] as const

export function TableStructureEditor({
  connection,
  table,
  onOpenSql,
  onApplied,
}: {
  connection: DbConnectionInfo
  table: DbTableSchema
  onOpenSql: (sql: string) => void
  onApplied: () => void
}) {
  const draft = useStructureDraft({ connection, table, onApplied })
  const { analysis, staleBase } = draft
  const [preview, setPreview] = useState(false)
  // The editor above is still fully usable; only the generated script is missing.
  const analysisProblem = useDbProblem(table.name, analysis.error, { consequence: 'none' })

  const applyChanges = async () => {
    await draft.applyChanges()
    // The preview closing on the re-read structure is the confirmation; no success row.
    setPreview(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkbenchToolbar aria-label="Structure editor controls" wrap className="gap-1.5">
        <div className="min-w-0 flex-1 text-2xs text-text-faint">
          {staleBase ? (
            <span className="flex items-center gap-1 text-status-warning">
              <AlertCircle className="size-3 shrink-0" />
              This table changed on the server while your edits were staged — the script below is
              diffed against the NEW structure. Reset to start from it.
            </span>
          ) : (
            'Edit fields directly. Changes stay staged until you review the SQL.'
          )}
        </div>
        <span
          className={
            analysis.plan.changeCount > 0
              ? 'text-2xs font-medium text-status-warning'
              : 'text-2xs text-text-faint'
          }
        >
          {analysis.plan.changeCount} pending
        </span>
        <Button size="xs" variant="ghost" onClick={draft.addColumn}>
          <Plus className="size-3" />
          Add column
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={analysis.plan.changeCount === 0 && !analysis.error}
          onClick={draft.reset}
        >
          <RotateCcw className="size-3" />
          Reset
        </Button>
        <Button
          size="xs"
          disabled={!analysis.plan.sql || !!analysis.error}
          onClick={() => setPreview(true)}
        >
          <Eye className="size-3" />
          Review & apply
        </Button>
      </WorkbenchToolbar>

      <div className="min-h-0 flex-1 overflow-auto p-3 scrollbar-thin">
        <StructureTable minWidth="min-w-[820px]" columns={EDITOR_COLUMNS}>
          {draft.drafts.map((column) => (
            <StructureRow
              key={column.id}
              column={column}
              table={table}
              connection={connection}
              draft={draft}
            />
          ))}
        </StructureTable>
        <div className="mt-2 flex items-start gap-2 text-3xs leading-relaxed text-text-faint">
          <AlertCircle className="mt-0.5 size-3 shrink-0" />
          <span>
            Primary and foreign-key columns are protected from removal — drop the constraint in the
            SQL console first, since this editor changes columns only. Default values are SQL
            expressions, for example <code className="text-text-soft">CURRENT_TIMESTAMP</code> or{' '}
            <code className="text-text-soft">'draft'</code>.
          </span>
        </div>
      </div>

      {analysisProblem && <ProblemLine {...analysisProblem} className="shrink-0 px-3 py-1.5" />}

      <SqlPreviewDialog
        open={preview}
        title={`Alter ${table.name}`}
        sql={analysis.plan.sql}
        warnings={analysis.plan.warnings}
        onOpenSql={onOpenSql}
        onApply={analysis.plan.manualOnly ? undefined : applyChanges}
        applyLabel="Apply changes"
        onClose={() => setPreview(false)}
      />
    </div>
  )
}
