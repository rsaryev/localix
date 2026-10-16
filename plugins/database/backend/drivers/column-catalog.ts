/**
 * Every table's column names in ONE catalog query — what autocomplete, column search and the SQL
 * diagnostics need, without the full structure read (`tableSchema`) the UI used to issue once per
 * table. On PostgreSQL a full structure read is ~20 catalog queries, so prefetching 150 tables cost
 * thousands of round trips through a `max: 1` pool; this costs one.
 *
 * Deliberately thin: name, type text and primary-key membership. Anything richer (FKs, defaults,
 * DDL) stays on the per-table read a person opens.
 */
import type { RowsExecutor } from './fk-rows'

export interface DbCatalogColumn {
  name: string
  dataType: string
  pk: boolean
}

export interface DbCatalogTable {
  /** The group name exactly as `schemas()` keys it. */
  schema: string
  table: string
  columns: DbCatalogColumn[]
}

export type DbColumnCatalog = DbCatalogTable[]

interface CatalogRow {
  table_schema: string
  table_name: string
  column_name: string
  data_type: string
  is_pk: boolean | number | string | null
}

/** Group ordered (schema, table, column) rows into tables. Pure; rows must arrive grouped. */
export function groupCatalogRows(rows: readonly CatalogRow[]): DbColumnCatalog {
  const out: DbColumnCatalog = []
  let current: DbCatalogTable | undefined
  for (const row of rows) {
    if (!current || current.schema !== row.table_schema || current.table !== row.table_name) {
      current = { schema: row.table_schema, table: row.table_name, columns: [] }
      out.push(current)
    }
    current.columns.push({
      name: row.column_name,
      dataType: row.data_type,
      pk: row.is_pk === true || row.is_pk === 1 || row.is_pk === '1' || row.is_pk === 't',
    })
  }
  return out
}

/** PostgreSQL: user-visible relations (incl. materialized views) via pg_attribute. */
export const PG_COLUMN_CATALOG_SQL = `SELECT n.nspname::text AS table_schema, c.relname::text AS table_name,
       a.attname::text AS column_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
       EXISTS (
         SELECT 1 FROM pg_catalog.pg_constraint pk
         WHERE pk.conrelid = c.oid AND pk.contype = 'p' AND a.attnum = ANY (pk.conkey)
       ) AS is_pk
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\\_toast%'
  AND n.nspname NOT LIKE 'pg\\_temp\\_%'
  AND (has_table_privilege(c.oid, 'SELECT') OR has_any_column_privilege(c.oid, 'SELECT'))
ORDER BY n.nspname, c.relname, a.attnum`

/** MySQL / MariaDB: the current database, matching `mysqlSchemas`. */
export const MYSQL_COLUMN_CATALOG_SQL = `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name,
       COLUMN_NAME AS column_name, COLUMN_TYPE AS data_type,
       (COLUMN_KEY = 'PRI') AS is_pk
FROM information_schema.columns
WHERE table_schema = DATABASE()
ORDER BY TABLE_NAME, ORDINAL_POSITION`

/** SQL Server: INFORMATION_SCHEMA, matching `mssqlSchemas`. */
export const MSSQL_COLUMN_CATALOG_SQL = `SELECT c.TABLE_SCHEMA AS table_schema, c.TABLE_NAME AS table_name,
       c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type,
       CASE WHEN EXISTS (
         SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
         JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
           ON k.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
         WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND k.TABLE_SCHEMA = c.TABLE_SCHEMA
           AND k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME
       ) THEN 1 ELSE 0 END AS is_pk
FROM INFORMATION_SCHEMA.COLUMNS c
ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`

export async function readColumnCatalog(rows: RowsExecutor, sql: string): Promise<DbColumnCatalog> {
  return groupCatalogRows(await rows<CatalogRow>(sql))
}
