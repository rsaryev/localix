// MySQL / MariaDB introspection over information_schema. Pure with respect to the
// connection: catalog queries run through the driver's RowsExecutor.
import type { DbColumn, DbSchemas, DbTableSchema } from './port'
import { groupIndexRows } from './index-rows'
import { groupForeignKeyRows, normalizeReferentialAction, type RowsExecutor } from './fk-rows'
import { quoteIdent } from '../sql-ident'
import { mysqlTableCreateScript, mysqlTriggerCreationContext } from './mysql-native-ddl'

export async function mysqlCurrentDatabase(objectRows: RowsExecutor): Promise<string> {
  const [{ db }] = await objectRows<{ db: string | null }>('SELECT DATABASE() AS db')
  return db ?? ''
}

export async function mysqlSchemas(objectRows: RowsExecutor): Promise<DbSchemas> {
  const [db, items] = await Promise.all([
    mysqlCurrentDatabase(objectRows),
    objectRows<{ TABLE_NAME: string; TABLE_TYPE: string }>(
      `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.tables
       WHERE table_schema = DATABASE() ORDER BY TABLE_NAME`,
    ),
  ])
  return {
    [db || 'database']: items.map((it) => ({
      name: it.TABLE_NAME,
      type: it.TABLE_TYPE === 'VIEW' ? 'view' : 'table',
    })),
  }
}

export async function mysqlTableSchema(
  objectRows: RowsExecutor,
  schema: string | undefined,
  table: string,
): Promise<DbTableSchema> {
  const sch = schema || (await mysqlCurrentDatabase(objectRows))
  const colRowsPromise = objectRows<{
    COLUMN_NAME: string
    COLUMN_TYPE: string
    IS_NULLABLE: string
    COLUMN_DEFAULT: string | null
    COLUMN_KEY: string
  }>(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY
     FROM information_schema.columns WHERE table_schema = ? AND table_name = ?
     ORDER BY ORDINAL_POSITION`,
    [sch, table],
  )
  const fkRowsPromise = objectRows<{
    CONSTRAINT_NAME: string
    COLUMN_NAME: string
    REFERENCED_TABLE_SCHEMA: string
    REFERENCED_TABLE_NAME: string
    REFERENCED_COLUMN_NAME: string
    UPDATE_RULE: string
    DELETE_RULE: string
  }>(
    `SELECT kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_SCHEMA,
            kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME,
            rc.UPDATE_RULE, rc.DELETE_RULE
     FROM information_schema.key_column_usage kcu
     JOIN information_schema.referential_constraints rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND rc.TABLE_NAME = kcu.TABLE_NAME
      AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
     WHERE kcu.table_schema = ? AND kcu.table_name = ?
       AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
    [sch, table],
  )
  // INFORMATION_SCHEMA.STATISTICS is the parameterizable catalog equivalent of SHOW INDEX
  // and returns no rows for views. One row per key part; NON_UNIQUE=0 means unique.
  const idxRowsPromise = objectRows<{
    Key_name: string
    Column_name: string | null
    Seq_in_index: number
    Non_unique: number
    Is_constraint: number | boolean
    Collation: string | null
    Sub_part: number | null
  }>(
    `SELECT INDEX_NAME AS Key_name, COLUMN_NAME AS Column_name,
            SEQ_IN_INDEX AS Seq_in_index, NON_UNIQUE AS Non_unique,
            COLLATION AS Collation, SUB_PART AS Sub_part,
            EXISTS (
              SELECT 1 FROM information_schema.table_constraints tc
              WHERE tc.constraint_schema = s.table_schema
                AND tc.table_name = s.table_name
                AND tc.constraint_name = s.index_name
                AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
            ) AS Is_constraint
     FROM information_schema.statistics s
     WHERE s.table_schema = ? AND s.table_name = ? AND s.index_type = 'BTREE'
     ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [sch, table],
  )
  // Reconstruct from INFORMATION_SCHEMA instead of SHOW CREATE TRIGGER: the latter
  // copies the database account from DEFINER into user/model-facing DDL. ACTION_ORDER
  // preserves activation order when multiple triggers share an event and timing.
  const triggerRowsPromise = objectRows<{
    TRIGGER_NAME: string
    EVENT_MANIPULATION: string
    ACTION_TIMING: string
    ACTION_STATEMENT: string
    ACTION_ORDER: number | string
    SQL_MODE: string | null
    CHARACTER_SET_CLIENT: string | null
    COLLATION_CONNECTION: string | null
  }>(
    `SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING, ACTION_STATEMENT,
            ACTION_ORDER, SQL_MODE, CHARACTER_SET_CLIENT, COLLATION_CONNECTION
     FROM information_schema.triggers
     WHERE event_object_schema = ? AND event_object_table = ?
     ORDER BY ACTION_TIMING, EVENT_MANIPULATION, ACTION_ORDER, TRIGGER_NAME`,
    [sch, table],
  )
  // information_schema.TABLES.TABLE_ROWS is the engine's cached estimate (approximate
  // for InnoDB — no scan). NULL for views / when unavailable ⇒ omit.
  const statRowsPromise = objectRows<{
    TABLE_ROWS: number | string | null
    TABLE_TYPE: string
  }>(
    `SELECT TABLE_ROWS, TABLE_TYPE FROM information_schema.tables
     WHERE table_schema = ? AND table_name = ? LIMIT 1`,
    [sch, table],
  )
  // SHOW CREATE TABLE is MySQL's canonical, executable table definition: it carries
  // generated/invisible/AUTO_INCREMENT column attributes, checks, indexes, charset,
  // collation and table options that normalized INFORMATION_SCHEMA fields cannot.
  // Do not run it for views: their SHOW output contains a DEFINER account, while the
  // dedicated information_schema.views path below deliberately avoids leaking that.
  const tableDefinitionRowsPromise = statRowsPromise.then((statRows) =>
    statRows[0]?.TABLE_TYPE === 'BASE TABLE'
      ? objectRows<Record<string, unknown>>(
          `SHOW CREATE TABLE ${quoteIdent(sch, 'mysql')}.${quoteIdent(table, 'mysql')}`,
        )
      : Promise.resolve([]),
  )
  // VIEWS exposes the canonical SELECT without requiring identifier interpolation and,
  // unlike SHOW CREATE VIEW, lets us avoid copying the database account from its DEFINER
  // clause into user/model-facing DDL. An absent row/definition means SHOW VIEW is not
  // available, so the shared DDL renderer will report that honestly.
  const viewRowsPromise = objectRows<{
    VIEW_DEFINITION: string | null
    CHECK_OPTION: string
    SECURITY_TYPE: string
  }>(
    `SELECT VIEW_DEFINITION, CHECK_OPTION, SECURITY_TYPE
     FROM information_schema.views
     WHERE table_schema = ? AND table_name = ? LIMIT 1`,
    [sch, table],
  )

  const [colRows, fkRows, idxRows, triggerRows, statRows, viewRows, tableDefinitionRows] =
    await Promise.all([
      colRowsPromise,
      fkRowsPromise,
      idxRowsPromise,
      triggerRowsPromise,
      statRowsPromise,
      viewRowsPromise,
      tableDefinitionRowsPromise,
    ])
  const columns: DbColumn[] = colRows.map((column) => ({
    name: column.COLUMN_NAME,
    // DATA_TYPE is only the base name (`varchar`, `decimal`); COLUMN_TYPE preserves
    // length/precision, enum members and attributes such as UNSIGNED for display/review.
    dataType: column.COLUMN_TYPE,
    nullable: column.IS_NULLABLE === 'YES',
    pk: column.COLUMN_KEY === 'PRI',
    defaultValue: column.COLUMN_DEFAULT,
  }))
  const primaryKey = colRows.flatMap((column) =>
    column.COLUMN_KEY === 'PRI' ? [column.COLUMN_NAME] : [],
  )
  const foreignKeys = groupForeignKeyRows(
    fkRows.map((row) => ({
      id: row.CONSTRAINT_NAME,
      column: row.COLUMN_NAME,
      refSchema: row.REFERENCED_TABLE_SCHEMA,
      refTable: row.REFERENCED_TABLE_NAME,
      refColumn: row.REFERENCED_COLUMN_NAME,
      onUpdate: normalizeReferentialAction(row.UPDATE_RULE),
      onDelete: normalizeReferentialAction(row.DELETE_RULE),
    })),
  )
  // MySQL reports functional key parts with Column_name=NULL and Expression populated.
  // DbIndex deliberately models physical columns only; keeping the other parts of a mixed
  // index would falsely describe its uniqueness and later reconstruct invalid quoted DDL.
  // Omit the whole unrepresentable index (functional parts cannot belong to PRIMARY).
  const functionalIndexes = new Set(
    idxRows.filter((row) => row.Column_name === null).map((row) => row.Key_name),
  )
  const indexes = groupIndexRows(
    idxRows
      .filter(
        (row): row is typeof row & { Column_name: string } =>
          row.Column_name !== null && !functionalIndexes.has(row.Key_name),
      )
      .map((row) => ({
        name: row.Key_name,
        column: row.Column_name,
        seq: Number(row.Seq_in_index),
        unique: Number(row.Non_unique) === 0,
        primary: row.Key_name === 'PRIMARY',
        constraint: Boolean(Number(row.Is_constraint)),
        descending: row.Collation === 'D',
        prefixLength: row.Sub_part == null ? null : Number(row.Sub_part),
      })),
  )
  const rawRows = statRows[0]?.TABLE_ROWS
  const tableRows = rawRows == null ? Number.NaN : Number(rawRows)
  // Omit a 0 estimate: InnoDB's TABLE_ROWS is 0 for small/newly-populated tables even when
  // they hold rows (it's a cached approximation, not a count), so surfacing "0" on a
  // non-empty table misleads. Showing nothing for a genuinely empty table is fine too.
  const approxRows = Number.isFinite(tableRows) && tableRows > 0 ? tableRows : undefined
  const viewRow = viewRows[0]
  const viewDefinition = viewRow?.VIEW_DEFINITION?.trim().replace(/;+\s*$/, '')
  const securityType = viewRow?.SECURITY_TYPE?.toUpperCase()
  const securityClause =
    securityType === 'DEFINER' || securityType === 'INVOKER' ? ` SQL SECURITY ${securityType}` : ''
  const checkOption = viewRow?.CHECK_OPTION?.toUpperCase()
  const checkClause =
    checkOption === 'CASCADED' || checkOption === 'LOCAL'
      ? `\nWITH ${checkOption} CHECK OPTION`
      : ''
  const createScript = viewDefinition
    ? `CREATE${securityClause} VIEW ${quoteIdent(sch, 'mysql')}.${quoteIdent(table, 'mysql')} AS\n${viewDefinition}${checkClause};`
    : mysqlTableCreateScript(tableDefinitionRows[0], sch, table)
  const relationName = `${quoteIdent(sch, 'mysql')}.${quoteIdent(table, 'mysql')}`
  const triggers = triggerRows.flatMap((trigger) => {
    const name = typeof trigger.TRIGGER_NAME === 'string' ? trigger.TRIGGER_NAME : ''
    const timing =
      typeof trigger.ACTION_TIMING === 'string' ? trigger.ACTION_TIMING.toUpperCase() : ''
    const event =
      typeof trigger.EVENT_MANIPULATION === 'string' ? trigger.EVENT_MANIPULATION.toUpperCase() : ''
    const body = typeof trigger.ACTION_STATEMENT === 'string' ? trigger.ACTION_STATEMENT.trim() : ''
    if (
      !name ||
      !body ||
      (timing !== 'BEFORE' && timing !== 'AFTER') ||
      (event !== 'INSERT' && event !== 'UPDATE' && event !== 'DELETE')
    )
      return []
    const context = mysqlTriggerCreationContext(trigger)
    return [
      {
        name,
        createScript:
          `CREATE TRIGGER ${quoteIdent(sch, 'mysql')}.${quoteIdent(name, 'mysql')} ` +
          `${timing} ${event} ON ${relationName} FOR EACH ROW\n${body}`,
        ...(context.pre.length ? { preCreateScripts: context.pre } : {}),
        ...(context.post.length ? { postCreateScripts: context.post } : {}),
      },
    ]
  })

  return {
    schema: sch,
    name: table,
    type: statRows[0]?.TABLE_TYPE === 'VIEW' ? 'view' : 'table',
    columns,
    primaryKey,
    foreignKeys,
    indexes,
    ...(triggers.length ? { triggers } : {}),
    approxRows,
    createScript,
    ...(createScript && statRows[0]?.TABLE_TYPE === 'BASE TABLE'
      ? { createScriptIncludesIndexes: true }
      : {}),
  }
}
