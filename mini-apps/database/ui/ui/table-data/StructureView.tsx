/** A database object's Structure view: Columns (the editor when the object is editable, a
 * read-only grid otherwise), Indexes and Relations, switched by a segmented control. */
import { useState } from 'react'
import { KeyRound, Lock } from 'lucide-react'
import type { MiniAppProblemLineProps } from '@localixai/mini-app-sdk/ui/components'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import { Spinner } from '@localixai/kit/spinner'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import type { DbConnectionInfo, DbTableSchema } from '../../dbClient'
import { DATABASE_DRIVER_CATALOG } from '../../../shared/driver-catalog'
import type { SchemaState } from '../../model/useSchema'
import { ObjectErrorState } from '../ObjectErrorState'
import { TableStructureEditor } from '../TableStructureEditor'
import { STRUCTURE_ROW_HOVER, StructureTable } from './StructureTable'
import type { DatabaseObjectTarget } from './target'

type Section = 'columns' | 'indexes' | 'relations'

function EmptySection({ children }: { children: string }) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-text-faint">
      {children}
    </div>
  )
}

function ColumnsGrid({ table }: { table: DbTableSchema }) {
  return (
    <StructureTable
      minWidth="min-w-[640px]"
      columns={[
        { label: 'Name', width: 'w-[38%]' },
        { label: 'Data type', width: 'w-[24%]' },
        { label: 'Nullability', width: 'w-[16%]' },
        { label: 'Default', width: 'w-[22%]' },
      ]}
    >
      {table.columns.map((column) => (
        <tr key={column.name} className={STRUCTURE_ROW_HOVER}>
          <td className="px-3 py-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {column.pk ? (
                <KeyRound className="size-3 shrink-0 text-status-warning" />
              ) : (
                <span className="size-3 shrink-0" />
              )}
              <span className="truncate text-xs font-medium text-foreground">{column.name}</span>
            </div>
          </td>
          <td className="truncate px-3 py-2 font-mono text-2xs text-text-soft">
            {column.dataType}
          </td>
          <td className="px-3 py-2 text-2xs text-text-faint">
            {column.nullable ? 'Nullable' : 'Required'}
          </td>
          <td className="truncate px-3 py-2 font-mono text-2xs text-text-faint">
            {column.defaultValue ?? '—'}
          </td>
        </tr>
      ))}
    </StructureTable>
  )
}

function IndexesGrid({ table }: { table: DbTableSchema }) {
  if (table.indexes.length === 0)
    return <EmptySection>No indexes reported by this engine.</EmptySection>
  return (
    <StructureTable
      minWidth="min-w-[560px]"
      columns={[
        { label: 'Name', width: 'w-[40%]' },
        { label: 'Columns', width: 'w-[42%]' },
        { label: 'Kind', width: 'w-[18%]' },
      ]}
    >
      {table.indexes.map((index) => (
        <tr key={index.name} className={STRUCTURE_ROW_HOVER}>
          <td className="truncate px-3 py-2 text-xs font-medium text-foreground">{index.name}</td>
          <td className="truncate px-3 py-2 font-mono text-2xs text-text-soft">
            {index.columns.join(', ')}
          </td>
          <td className="px-3 py-2 text-2xs text-text-faint">
            {index.primary ? 'Primary' : index.unique ? 'Unique' : 'Index'}
          </td>
        </tr>
      ))}
    </StructureTable>
  )
}

function RelationsGrid({ table }: { table: DbTableSchema }) {
  if (table.foreignKeys.length === 0)
    return <EmptySection>No foreign-key relationships.</EmptySection>
  return (
    <StructureTable
      minWidth="min-w-[600px]"
      columns={[
        { label: 'Local columns', width: 'w-[34%]' },
        { label: 'Referenced table', width: 'w-[38%]' },
        { label: 'Referenced columns', width: 'w-[28%]' },
      ]}
    >
      {table.foreignKeys.map((foreignKey) => (
        <tr
          key={[
            foreignKey.columns.join(','),
            foreignKey.refSchema ?? '',
            foreignKey.refTable,
            foreignKey.refColumns.join(','),
          ].join('→')}
          className={STRUCTURE_ROW_HOVER}
        >
          <td className="truncate px-3 py-2 font-mono text-2xs text-foreground">
            {foreignKey.columns.join(', ')}
          </td>
          <td className="truncate px-3 py-2 font-mono text-2xs text-status-info">
            {foreignKey.refSchema ? `${foreignKey.refSchema}.` : ''}
            {foreignKey.refTable}
          </td>
          <td className="truncate px-3 py-2 font-mono text-2xs text-text-soft">
            {foreignKey.refColumns.join(', ')}
          </td>
        </tr>
      ))}
    </StructureTable>
  )
}

export function StructureView({
  connection,
  target,
  schema,
  readProblem,
  onOpenConsoleWithSql,
}: {
  connection: DbConnectionInfo
  target: DatabaseObjectTarget
  schema: SchemaState
  /** The object's introspection failure, owned by the workspace above. */
  readProblem: MiniAppProblemLineProps | null
  onOpenConsoleWithSql: (sql: string) => void
}) {
  const [section, setSection] = useState<Section>('columns')

  const table = schema.getTable(target.table, target.schema)
  if (!table) {
    // Error BEFORE spinner: a failed introspection is not a slow one, and only an
    // explicit reload re-tries it.
    if (readProblem) return <ObjectErrorState problem={readProblem} />
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-text-faint">
        <Spinner className="size-3.5" />
        Reading structure…
      </div>
    )
  }
  if (table.columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-text-faint">
        This engine is schemaless. Sample documents or values in the Data view.
      </div>
    )
  }
  const canEdit =
    table.type === 'table' &&
    !connection.readonly &&
    DATABASE_DRIVER_CATALOG[connection.dialect].capabilities.schemaEditing
  const tabs: Array<[Section, string]> = [
    ['columns', `Columns · ${table.columns.length}`],
    ['indexes', `Indexes · ${table.indexes.length}`],
    ['relations', `Relations · ${table.foreignKeys.length}`],
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkbenchToolbar aria-label="Table structure controls">
        <SegmentedControl variant="muted" aria-label="Table structure section">
          {tabs.map(([id, label]) => (
            <SegmentedControlItem key={id} active={section === id} onClick={() => setSection(id)}>
              {label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        {!canEdit && (
          <span
            className="ml-auto flex items-center gap-1 text-2xs text-text-faint"
            title={
              connection.readonly
                ? 'This connection is read-only'
                : 'This object or driver does not support structure editing'
            }
          >
            <Lock className="size-3" />
            Read only
          </span>
        )}
      </WorkbenchToolbar>

      {/* Columns is HIDDEN, not unmounted, when another section shows: the editor inside it owns
          the staged column edits, and unmounting it would discard them. */}
      <div className={section === 'columns' ? 'min-h-0 flex-1' : 'hidden'}>
        {canEdit ? (
          <TableStructureEditor
            key={`${table.schema ?? ''}.${table.name}`}
            connection={connection}
            table={table}
            onOpenSql={onOpenConsoleWithSql}
            onApplied={() => schema.reloadTable(target.table, target.schema)}
          />
        ) : (
          <div className="h-full overflow-auto p-3 scrollbar-thin">
            <ColumnsGrid table={table} />
          </div>
        )}
      </div>
      {section !== 'columns' && (
        <div className="min-h-0 flex-1 overflow-auto p-3 scrollbar-thin">
          {section === 'indexes' ? <IndexesGrid table={table} /> : <RelationsGrid table={table} />}
        </div>
      )}
    </div>
  )
}
