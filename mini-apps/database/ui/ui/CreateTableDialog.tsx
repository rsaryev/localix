import { useId, useMemo, useState } from 'react'
import { Plus, TableProperties, Trash2 } from 'lucide-react'

import { Button } from '@localixai/kit/button'
import { Checkbox } from '@localixai/kit/checkbox'
import { CodeEditor } from '@localixai/kit/code-editor'
import { EmptyHint } from '@localixai/kit/empty-hint'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import { Select } from '@localixai/kit/select'
import { DATABASE_DRIVER_CATALOG } from '../../shared/driver-catalog'
import type { DbConnectionInfo } from '../dbClient'
import { buildCreateTableSql, type CreateTableColumn } from '../model/createTable'
import { focusOnMount } from './focusOnMount'

interface DraftColumn extends CreateTableColumn {
  /** Stable React identity while names/types are edited or a preceding row is removed. */
  draftId: string
}

const newColumn = (name: string, dataType: string, primaryKey = false): DraftColumn => ({
  draftId: crypto.randomUUID(),
  name,
  dataType,
  nullable: !primaryKey,
  primaryKey,
})

export function CreateTableDialog({
  open,
  connection,
  schemas,
  initialSchema,
  onOpenChange,
  onOpenSql,
}: {
  open: boolean
  connection: DbConnectionInfo
  schemas: string[]
  initialSchema?: string
  onOpenChange: (open: boolean) => void
  onOpenSql: (sql: string) => void
}) {
  const manifest = DATABASE_DRIVER_CATALOG[connection.dialect]
  const defaultType = manifest.schemaDataTypes[0] ?? 'TEXT'
  const initialColumns = useMemo(
    () => [
      newColumn('id', defaultType, true),
      newColumn(
        'name',
        manifest.schemaDataTypes.find((type) => /text|char/i.test(type)) ?? defaultType,
      ),
    ],
    [defaultType, manifest.schemaDataTypes],
  )
  const [table, setTable] = useState('')
  const [schema, setSchema] = useState<string>(initialSchema ?? manifest.defaultSchema)
  const [columns, setColumns] = useState<DraftColumn[]>(initialColumns)
  const schemaLabelId = useId()
  const tableId = useId()

  // This dialog stays mounted while the selected connection/schema changes. A fresh open
  // must never generate the new dialect's SQL from the prior database's type/schema draft, so
  // the draft restarts during render (not in an effect) whenever its inputs change while open.
  const draftInputs = [connection.id, initialColumns, initialSchema, manifest.defaultSchema, open]
  const [seenInputs, setSeenInputs] = useState(draftInputs)
  if (draftInputs.some((input, index) => !Object.is(input, seenInputs[index]))) {
    setSeenInputs(draftInputs)
    if (open) {
      setTable('')
      setSchema(initialSchema ?? manifest.defaultSchema)
      setColumns(initialColumns)
    }
  }

  const sql = useMemo(() => {
    try {
      return buildCreateTableSql(connection.dialect, {
        table,
        schema: manifest.capabilities.multipleSchemas ? schema || undefined : undefined,
        columns,
      })
    } catch {
      return ''
    }
  }, [connection.dialect, table, schema, columns, manifest.capabilities.multipleSchemas])

  const patchColumn = (draftId: string, patch: Partial<CreateTableColumn>) => {
    setColumns((current) =>
      current.map((column) => (column.draftId === draftId ? { ...column, ...patch } : column)),
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TableProperties className="size-4 text-text-faint" />
            Create table
          </DialogTitle>
          <DialogDescription>
            Design a dialect-correct draft, then review and run it in the query console.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="grid gap-4 pr-1">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {manifest.capabilities.multipleSchemas && (
              <div className="space-y-1">
                <span id={schemaLabelId} className="text-2xs font-medium text-text-soft">
                  Schema
                </span>
                <Select
                  aria-labelledby={schemaLabelId}
                  value={schema}
                  onValueChange={setSchema}
                  className="w-full"
                  options={[...new Set([schema, manifest.defaultSchema, ...schemas])]
                    .filter(Boolean)
                    .map((name) => ({ value: name, label: name }))}
                />
              </div>
            )}
            <label htmlFor={tableId} className="space-y-1">
              <span className="text-2xs font-medium text-text-soft">Table name</span>
              <Input
                id={tableId}
                value={table}
                ref={focusOnMount}
                onChange={(event) => setTable(event.target.value)}
                placeholder="customers"
                size="lg"
                // No fill override: Input owns the `--input` veil. `bg-background` is the WINDOW
                // ground — denser than the dialog's glass, so it read as a black slot in it.
              />
            </label>
          </div>

          <div className="overflow-hidden rounded-xl border border-border-soft">
            <div className="grid grid-cols-[minmax(8rem,1fr)_minmax(8rem,0.8fr)_5rem_5rem_1.5rem] gap-2 border-b border-border-soft bg-foreground/[0.04] px-3 py-1.5 text-2xs font-medium text-text-faint">
              <span>Name</span>
              <span>Type</span>
              <span>Nullable</span>
              <span>Primary</span>
              <span />
            </div>
            <div className="max-h-56 divide-y divide-border-soft overflow-y-auto scrollbar-thin">
              {columns.map((column, index) => (
                <div
                  key={column.draftId}
                  className="grid grid-cols-[minmax(8rem,1fr)_minmax(8rem,0.8fr)_5rem_5rem_1.5rem] items-center gap-2 px-3 py-1.5"
                >
                  <Input
                    value={column.name}
                    onChange={(event) => patchColumn(column.draftId, { name: event.target.value })}
                    placeholder="column_name"
                    // No ground fill — see the table-name field above; Input owns the veil.
                    className="text-2xs"
                  />
                  <Select
                    size="md"
                    value={column.dataType}
                    onValueChange={(dataType) => patchColumn(column.draftId, { dataType })}
                    aria-label={`${column.name || `Column ${index + 1}`} data type`}
                    className="w-full min-w-0 font-mono text-2xs"
                    contentClassName="font-mono"
                    options={manifest.schemaDataTypes.map((type) => ({
                      value: type,
                      label: type,
                    }))}
                  />
                  <Checkbox
                    checked={column.nullable && !column.primaryKey}
                    disabled={column.primaryKey}
                    onChange={(event) =>
                      patchColumn(column.draftId, { nullable: event.target.checked })
                    }
                    aria-label={`${column.name || `Column ${index + 1}`} nullable`}
                    className="size-3.5 justify-self-center"
                  />
                  <Checkbox
                    checked={column.primaryKey}
                    onChange={(event) =>
                      patchColumn(column.draftId, {
                        primaryKey: event.target.checked,
                        ...(event.target.checked ? { nullable: false } : {}),
                      })
                    }
                    aria-label={`${column.name || `Column ${index + 1}`} primary key`}
                    className="size-3.5 justify-self-center"
                  />
                  <IconButton
                    size="xs"
                    aria-label={`Remove ${column.name || `column ${index + 1}`}`}
                    disabled={columns.length === 1}
                    onClick={() =>
                      setColumns((current) =>
                        current.filter((candidate) => candidate.draftId !== column.draftId),
                      )
                    }
                  >
                    <Trash2 className="size-3" />
                  </IconButton>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setColumns((current) => [...current, newColumn('', defaultType)])}
              className="flex w-full items-center justify-center gap-1 border-t border-border-soft py-1.5 text-2xs text-text-soft outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
            >
              <Plus className="size-3" />
              Add column
            </button>
          </div>

          {sql ? (
            // `surface-sunken`, not `bg-background`: this is a code inset, and sunken is a black
            // veil relative to whatever it covers, where `--background` is the WINDOW ground —
            // denser than the dialog's glass, so the preview read as a black plate on it.
            <div className="h-36 overflow-hidden rounded-lg border border-border-soft bg-surface-sunken">
              <CodeEditor
                value={sql}
                language="sql"
                readOnly
                ariaLabel="Create table SQL preview"
                className="h-full"
              />
            </div>
          ) : (
            <EmptyHint className="h-20 p-3 text-xs">
              Enter a table name and at least one column.
            </EmptyHint>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!sql}
            onClick={() => {
              if (!sql) return
              onOpenSql(sql)
              onOpenChange(false)
            }}
          >
            Open SQL in console
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
