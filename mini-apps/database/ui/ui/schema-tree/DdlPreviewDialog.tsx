import { useState } from 'react'
import type { DbDialect } from '../../dbClient'
import { buildTableDDL } from '../../model/schemaDDL'
import type { SchemaReader } from '../../model/schemaTreeRows'
import { SqlPreviewDialog } from '../SqlPreviewDialog'

export interface DdlTarget {
  connectionId: string
  table: string
  schema?: string
}

export function useDdlTarget() {
  const [target, setTarget] = useState<DdlTarget | null>(null)
  return { target, open: setTarget, close: () => setTarget(null) }
}

/**
 * "View DDL…" for a tree object, written ONCE for both trees.
 *
 * The defect it stops: the connections tree rendered its own copy of this dialog and left out
 * `loadError`/`onRetryLoad`, so an object whose structure could not be read showed a spinner
 * forever there while the schema sidebar's copy showed the reason and a Retry. One component
 * cannot drop a prop in one of its call sites.
 */
export function DdlPreviewDialog({
  target,
  reader,
  dialect,
  onClose,
}: {
  target: DdlTarget | null
  reader:
    | Pick<SchemaReader, 'getTable' | 'getTableError' | 'getTableErrorDetail' | 'reloadTable'>
    | undefined
  dialect: DbDialect
  onClose: () => void
}) {
  const table = target && reader ? reader.getTable(target.table, target.schema) : undefined
  return (
    <SqlPreviewDialog
      open={target !== null}
      title={target?.table ?? ''}
      sql={table ? buildTableDDL(table, dialect) : ''}
      loadError={target && reader ? reader.getTableError(target.table, target.schema) : undefined}
      loadErrorDetail={
        target && reader ? reader.getTableErrorDetail(target.table, target.schema) : undefined
      }
      onRetryLoad={() => {
        if (target && reader) reader.reloadTable(target.table, target.schema)
      }}
      onClose={onClose}
    />
  )
}
