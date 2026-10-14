import type { Database } from 'bun:sqlite'
import type { DbColumn, DbSchemas, DbTableSchema, DbForeignKey, DbIndex } from './port'
import { normalizeReferentialAction } from './fk-rows'
import { quoteIdent as quoteSqlIdent } from '../sql-ident'

/** Double-quote a SQLite identifier for interpolation into PRAGMA calls (which can't be parametrized). */
const quoteIdent = (name: string): string => quoteSqlIdent(name, 'sqlite')

const sqliteNumber = (value: number | bigint): number => Number(value)

/** Catalog readers for one SQLite handle; the driver owns their exclusive lease. */
export function createSqliteIntrospection(db: Database) {
  async function schemasUnlocked(): Promise<DbSchemas> {
    const rows = db
      .query(
        `SELECT name, type FROM sqlite_schema
         WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string; type: 'table' | 'view' }>
    return { main: rows.map((r) => ({ name: r.name, type: r.type })) }
  }

  async function tableSchemaUnlocked(
    _schema: string | undefined,
    table: string,
  ): Promise<DbTableSchema> {
    const info = db.query(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{
      name: string
      type: string
      notnull: number | bigint
      pk: number | bigint
      dflt_value: string | null
    }>
    const columns: DbColumn[] = info.map((c) => ({
      name: c.name,
      dataType: c.type,
      // SQLite reports `notnull = 0` for `INTEGER PRIMARY KEY`, even though a primary
      // key cannot be NULL. Normalize that semantic invariant for every UI consumer.
      nullable: sqliteNumber(c.pk) === 0 && sqliteNumber(c.notnull) === 0,
      pk: sqliteNumber(c.pk) > 0,
      defaultValue: c.dflt_value,
    }))
    const primaryKey = info
      .filter((c) => sqliteNumber(c.pk) > 0)
      .sort((a, b) => sqliteNumber(a.pk) - sqliteNumber(b.pk))
      .map((c) => c.name)

    const fkRows = db.query(`PRAGMA foreign_key_list(${quoteIdent(table)})`).all() as Array<{
      id: number | bigint
      from: string
      to: string | null
      table: string
      seq: number | bigint
      on_update: string
      on_delete: string
    }>
    const fkById = new Map<number, DbForeignKey>()
    for (const r of fkRows.sort(
      (a, b) =>
        sqliteNumber(a.id) - sqliteNumber(b.id) || sqliteNumber(a.seq) - sqliteNumber(b.seq),
    )) {
      const id = sqliteNumber(r.id)
      const existing = fkById.get(id)
      if (existing) {
        existing.columns.push(r.from)
        if (r.to !== null) existing.refColumns.push(r.to)
      } else {
        fkById.set(id, {
          columns: [r.from],
          refTable: r.table,
          refColumns: r.to === null ? [] : [r.to],
          onUpdate: normalizeReferentialAction(r.on_update),
          onDelete: normalizeReferentialAction(r.on_delete),
        })
      }
    }

    const objType = db
      .query(`SELECT type, sql FROM sqlite_schema WHERE name = ? LIMIT 1`)
      .get(table) as { type: 'table' | 'view'; sql: string | null } | null

    // sqlite_schema.sql is authoritative for explicit indexes, including expression keys
    // and partial predicates that the normalized DbIndex fields cannot fully represent.
    // Keep those indexes for exact DDL export, but mark their structured fields as display
    // hints so mutation planners never reconstruct a wider/different index from them.
    const idxList = db.query(`PRAGMA index_list(${quoteIdent(table)})`).all() as Array<{
      name: string
      unique: number | bigint
      origin: string // 'pk' | 'u' | 'c'
      partial: number | bigint
    }>
    const indexes: DbIndex[] = idxList.flatMap((idx) => {
      const cols = db.query(`PRAGMA index_info(${quoteIdent(idx.name)})`).all() as Array<{
        seqno: number | bigint
        cid: number | bigint
        name: string | null
      }>
      const indexScript =
        idx.origin === 'c'
          ? (
              db
                .query(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1`)
                .get(idx.name) as { sql: string | null } | null
            )?.sql
          : null
      const hasExpression = cols.some(
        (column) => sqliteNumber(column.cid) === -2 || column.name === null,
      )
      const createScriptOnly = sqliteNumber(idx.partial) === 1 || hasExpression
      if (createScriptOnly && !indexScript) return []
      const orderedColumns = cols.sort((a, b) => sqliteNumber(a.seqno) - sqliteNumber(b.seqno))
      return [
        {
          name: idx.name,
          // A partial index still has an exact physical key list. For expression indexes,
          // an incomplete list would be misleading, so the native definition stands alone.
          columns: hasExpression ? [] : orderedColumns.map((column) => column.name as string),
          unique: sqliteNumber(idx.unique) === 1,
          primary: idx.origin === 'pk',
          ...(idx.origin === 'u' ? { constraint: true } : {}),
          ...(indexScript ? { createScript: indexScript } : {}),
          ...(createScriptOnly ? { createScriptOnly: true } : {}),
        },
      ]
    })
    const triggers = (
      db
        .query(
          `SELECT name, sql FROM sqlite_schema
         WHERE type = 'trigger' AND tbl_name = ? AND sql IS NOT NULL
         ORDER BY name`,
        )
        .all(table) as Array<{ name: string; sql: string }>
    ).map((trigger) => ({
      name: trigger.name,
      createScript: trigger.sql,
    }))

    return {
      name: table,
      type: objType?.type ?? 'table',
      columns,
      primaryKey,
      foreignKeys: [...fkById.values()],
      indexes,
      ...(triggers.length ? { triggers } : {}),
      approxRows: approxRowCount(table),
      createScript: objType?.sql ?? undefined,
    }
  }

  /**
   * SQLite has no cheap live row estimate. The only free source is `sqlite_stat1`
   * (populated by `ANALYZE`): its `stat` text starts with the estimated row count.
   * Absent stats table or row ⇒ undefined (never run `COUNT(*)`, which scans the table).
   */
  function approxRowCount(table: string): number | undefined {
    try {
      const row = db.query(`SELECT stat FROM sqlite_stat1 WHERE tbl = ? LIMIT 1`).get(table) as {
        stat: string | null
      } | null
      const first = row?.stat?.trim().split(/\s+/)[0]
      const n = first ? Number(first) : Number.NaN
      return Number.isFinite(n) && n >= 0 ? n : undefined
    } catch {
      // No sqlite_stat1 table (never ANALYZEd) — omit rather than scan.
      return undefined
    }
  }

  return { schemasUnlocked, tableSchemaUnlocked }
}
