/**
 * The diagnostics' view of one connection's schema, shared by the console and `.sql` files so
 * both check a query against the same picture — two surfaces building it separately is how one
 * of them would start flagging what the other accepts.
 */
import { useCallback, useMemo } from 'react'
import type { SchemaState } from '../useSchema'
import { createSqlCatalog, type SqlCatalog } from './catalog'

export function useSqlCatalog(
  schema: Pick<SchemaState, 'schemas' | 'getColumnSource' | 'ensureColumns'>,
): {
  catalog: SqlCatalog | null
  onWantColumns: (tables: Array<{ name: string; schema: string }>) => void
} {
  const { schemas, getColumnSource, ensureColumns } = schema
  // `getColumnSource` changes identity when columns arrive, which is what re-runs the check.
  const catalog = useMemo(
    () => createSqlCatalog(schemas, getColumnSource),
    [schemas, getColumnSource],
  )
  const onWantColumns = useCallback(
    (tables: Array<{ name: string; schema: string }>) =>
      ensureColumns(
        tables.map((table) => ({ name: table.name, schema: table.schema || undefined })),
      ),
    [ensureColumns],
  )
  return { catalog, onWantColumns }
}
