/** One editable column row of the structure editor: name, type, nullability, default SQL, its
 * diff status, and the stage-removal / undo action. */
import { KeyRound, Link2, Trash2, Undo2 } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Checkbox } from '@localixai/kit/checkbox'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import { DATABASE_DRIVER_CATALOG } from '../../../shared/driver-catalog'
import type { DbConnectionInfo, DbTableSchema } from '../../dbClient'
import type { AlterColumnDraft } from '../../model/alterTable'
import { DB_BADGE } from '../dbBadge'
import { DefaultSqlEditor } from '../DefaultSqlEditor'
import { STRUCTURE_ROW_HOVER } from '../table-data/StructureTable'
import { engineFilledColumn, rowStatus, type ColumnRowStatus } from './columnFacts'
import type { StructureDraft } from './useStructureDraft'

const ROW_TINT: Record<ColumnRowStatus, string> = {
  discarded: STRUCTURE_ROW_HOVER,
  added: 'bg-status-success/[0.035]',
  removed: STRUCTURE_ROW_HOVER,
  modified: 'bg-status-warning/[0.025]',
  unchanged: STRUCTURE_ROW_HOVER,
}

const STATUS_TEXT: Record<ColumnRowStatus, string> = {
  discarded: 'text-text-faint',
  added: 'text-status-success',
  removed: 'text-status-error',
  modified: 'text-status-warning',
  unchanged: 'text-text-faint',
}

// No fill or radius override on these inputs: Input already carries the `--input` veil and the
// scale's radius. `bg-background` is the pane's OWN ground — cleared by the once-only rule under
// glass, and a flat pane-coloured slot on the opaque themes.
const FIELD = 'h-7 border-control-border px-2 font-mono text-2xs'

export function StructureRow({
  column,
  table,
  connection,
  draft,
}: {
  column: AlterColumnDraft
  table: DbTableSchema
  connection: DbConnectionInfo
  draft: StructureDraft
}) {
  const { manifest, fkColumns, baseColumns, patch } = draft
  const mutations = manifest.schemaMutations
  const engineLabel = DATABASE_DRIVER_CATALOG[connection.dialect].label
  const status = rowStatus(column, table)
  const existing = !!column.originalName
  const isFk = fkColumns.has(column.originalName ?? '')
  const protectedColumn = existing && (column.primaryKey || isFk)
  const base = column.originalName ? baseColumns.get(column.originalName) : undefined
  const engineFilled = engineFilledColumn(base)
  const typeOptions = [...new Set([column.dataType, ...manifest.schemaDataTypes])]
  const dataListId = `database-types-${column.id}`
  const label = column.name || 'new column'

  return (
    <tr className={column.deleted ? 'bg-status-error/[0.035] opacity-65' : ROW_TINT[status]}>
      <td className="px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {column.primaryKey ? (
            <KeyRound className="size-3 shrink-0 text-status-warning" aria-label="Primary key" />
          ) : isFk ? (
            <Link2 className="size-3 shrink-0 text-status-info" aria-label="Foreign key" />
          ) : (
            <span className="size-3 shrink-0" />
          )}
          <Input
            value={column.name}
            disabled={column.deleted || (existing && !mutations?.renameColumn)}
            onChange={(event) => patch(column.id, { name: event.target.value })}
            placeholder="column_name"
            spellCheck={false}
            aria-label={`Name for ${column.originalName ?? 'new column'}`}
            className={cn(FIELD, 'min-w-0 flex-1')}
          />
          {engineFilled && (
            <span title={engineFilled.title} className={DB_BADGE}>
              <engineFilled.icon className="size-2.5" aria-hidden />
              {engineFilled.badge}
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-1.5">
        <Input
          value={column.dataType}
          list={dataListId}
          disabled={column.deleted || (existing && !mutations?.alterColumnType)}
          onChange={(event) => patch(column.id, { dataType: event.target.value })}
          spellCheck={false}
          aria-label={`Data type for ${label}`}
          className={cn(FIELD, 'w-full')}
        />
        <datalist id={dataListId}>
          {typeOptions.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </datalist>
      </td>
      <td className="px-2 py-1.5 text-center">
        <Checkbox
          checked={column.nullable && !column.primaryKey}
          disabled={
            column.deleted ||
            column.primaryKey ||
            !!base?.identity ||
            (existing && !mutations?.alterColumnNullability)
          }
          title={
            column.primaryKey
              ? 'Primary-key columns cannot be nullable'
              : base?.identity
                ? 'An identity column is implicitly NOT NULL'
                : existing && !mutations?.alterColumnNullability
                  ? `${engineLabel} cannot change an existing column's nullability`
                  : ''
          }
          onChange={(event) => patch(column.id, { nullable: event.target.checked })}
          aria-label={`${column.name || 'New column'} nullable`}
          className="size-3.5 disabled:opacity-45"
        />
      </td>
      <td className="px-2 py-1.5">
        <DefaultSqlEditor
          value={column.defaultValue}
          columnName={column.name}
          dataType={column.dataType}
          dialect={connection.dialect}
          disabled={
            column.deleted || !!base?.generated || (existing && !mutations?.alterColumnDefault)
          }
          disabledReason={
            base?.generated
              ? 'A generated column cannot have a default — its value is computed from its expression. Change the expression in the SQL console.'
              : existing && !mutations?.alterColumnDefault
                ? `${engineLabel} cannot change an existing column's default`
                : undefined
          }
          emptyLabel={engineFilled?.emptyLabel}
          onChange={(defaultValue) => patch(column.id, { defaultValue })}
        />
      </td>
      <td className="px-2 py-1.5">
        <span className={cn('block truncate text-3xs font-medium capitalize', STATUS_TEXT[status])}>
          {status}
        </span>
      </td>
      <td className="px-1 py-1.5 text-center">
        {column.deleted ? (
          <IconButton
            size="xs"
            aria-label={`Undo removal of ${column.name}`}
            onClick={() => patch(column.id, { deleted: false })}
          >
            <Undo2 className="size-3" />
          </IconButton>
        ) : (
          <IconButton
            size="xs"
            tone="danger"
            disabled={protectedColumn}
            aria-label={`Remove ${label}`}
            tooltip={
              protectedColumn
                ? 'Drop the primary/foreign-key constraint in the SQL console before removing this column'
                : 'Stage column removal'
            }
            onClick={() =>
              existing ? patch(column.id, { deleted: true }) : draft.discard(column.id)
            }
          >
            <Trash2 className="size-3" />
          </IconButton>
        )}
      </td>
    </tr>
  )
}
