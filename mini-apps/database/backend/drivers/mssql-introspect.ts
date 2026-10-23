// SQL Server introspection over INFORMATION_SCHEMA + sys catalog views. Pure with
// respect to the connection: catalog queries run through the driver's RowsExecutor.
import type { DbCheckConstraint, DbColumn, DbSchemas, DbTableSchema } from './port'
import { groupIndexRows } from './index-rows'
import { groupForeignKeyRows, normalizeReferentialAction, type RowsExecutor } from './fk-rows'
import { recordArray } from '../../shared/safe-record'
import { maskSqlNonCode, MSSQL_SQL_GRAMMAR } from '../../shared/sql-regions'
import { quoteIdent } from '../sql-ident'

function mssqlViewCreateScript(
  definition: string | null | undefined,
  schema: string,
  table: string,
  columns: DbColumn[],
  schemaBound: boolean,
  viewMetadata: boolean,
): string | undefined {
  if (!definition?.trim()) return undefined

  // sys.sql_modules keeps the original module text even after sp_rename. Extract only
  // the body and rebuild the header from current catalog identity/flags, otherwise a DDL
  // export can silently create the view under its stale former name. Masking makes AS in
  // comments, quoted identifiers and literals invisible without changing source offsets.
  const masked = maskSqlNonCode(definition, MSSQL_SQL_GRAMMAR)
  const header = /\b(?:CREATE(?:\s+OR\s+ALTER)?|ALTER)\s+VIEW\b/iu.exec(masked)
  if (!header) return undefined
  const afterHeader = header.index + header[0].length
  const asKeyword = /\bAS\b/iu.exec(masked.slice(afterHeader))
  if (!asKeyword) return undefined
  const body = definition.slice(afterHeader + asKeyword.index + asKeyword[0].length).trim()
  if (!body) return undefined

  const q = (name: string) => quoteIdent(name, 'mssql')
  const columnList =
    columns.length > 0 ? ` (${columns.map((column) => q(column.name)).join(', ')})` : ''
  const attributes = [
    schemaBound ? 'SCHEMABINDING' : '',
    viewMetadata ? 'VIEW_METADATA' : '',
  ].filter(Boolean)
  const attributeClause = attributes.length > 0 ? `\nWITH ${attributes.join(', ')}` : ''
  const terminator = /;\s*$/u.test(body) ? '' : '\n;'
  return `CREATE VIEW ${q(schema)}.${q(table)}${columnList}${attributeClause}\nAS\n${body}${terminator}`
}

function mssqlTriggerCreateScript(
  definition: string | null | undefined,
  schema: string,
  table: string,
  trigger: string,
): string | undefined {
  if (!definition?.trim()) return undefined

  // Like views, trigger module text keeps stale identifiers after sp_rename.
  // Preserve everything after the current target while rebuilding both catalog-owned
  // identifiers. Masked SQL keeps keywords inside names/comments/literals inert.
  const masked = maskSqlNonCode(definition, MSSQL_SQL_GRAMMAR)
  const header = /\b(?:CREATE(?:\s+OR\s+ALTER)?|ALTER)\s+TRIGGER\b/iu.exec(masked)
  if (!header) return undefined
  const afterHeader = header.index + header[0].length
  const onKeyword = /\bON\b/iu.exec(masked.slice(afterHeader))
  if (!onKeyword) return undefined
  const afterOn = afterHeader + onKeyword.index + onKeyword[0].length
  const bodyKeyword = /\b(?:WITH|FOR|AFTER|INSTEAD\s+OF)\b/iu.exec(masked.slice(afterOn))
  if (!bodyKeyword) return undefined
  const body = definition.slice(afterOn + bodyKeyword.index).trim()
  if (!body) return undefined

  const q = (name: string) => quoteIdent(name, 'mssql')
  return `CREATE TRIGGER ${q(schema)}.${q(trigger)}\nON ${q(schema)}.${q(table)}\n${body}`
}

export async function mssqlSchemas(objectRows: RowsExecutor): Promise<DbSchemas> {
  const items = await objectRows<{
    TABLE_SCHEMA: string
    TABLE_NAME: string
    TABLE_TYPE: string
  }>(
    `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_SCHEMA, TABLE_NAME`,
  )
  const out: DbSchemas = {}
  for (const it of items) {
    recordArray(out, it.TABLE_SCHEMA).push({
      name: it.TABLE_NAME,
      type: it.TABLE_TYPE === 'VIEW' ? 'view' : 'table',
    })
  }
  return out
}

export async function mssqlTableSchema(
  objectRows: RowsExecutor,
  sch: string,
  table: string,
): Promise<DbTableSchema> {
  const colRowsPromise = objectRows<{
    COLUMN_NAME: string
    DATA_TYPE: string
    CHARACTER_MAXIMUM_LENGTH: number | null
    NUMERIC_PRECISION: number | null
    NUMERIC_SCALE: number | null
    DATETIME_PRECISION: number | null
    IS_NULLABLE: string
    COLUMN_DEFAULT: string | null
    DEFAULT_CONSTRAINT_NAME: string | null
    COLLATION_NAME: string | null
    IS_ROWGUID: boolean
    IS_SPARSE: boolean
    IS_COLUMN_SET: boolean
    COMPUTED_DEFINITION: string | null
    IS_PERSISTED: boolean | null
    IDENTITY_SEED: string | null
    IDENTITY_INCREMENT: string | null
    IDENTITY_NOT_FOR_REPLICATION: boolean | null
    GENERATED_ALWAYS_TYPE: string
    IS_HIDDEN: boolean
    MASKING_FUNCTION: string | null
  }>(
    `SELECT col.name AS COLUMN_NAME, COALESCE(info.DATA_TYPE, type_info.name) AS DATA_TYPE,
            COALESCE(
              info.CHARACTER_MAXIMUM_LENGTH,
              CASE
                WHEN type_info.name IN ('nchar', 'nvarchar') AND col.max_length <> -1
                  THEN col.max_length / 2
                WHEN type_info.name IN ('char', 'varchar', 'binary', 'varbinary')
                  THEN col.max_length
              END
            ) AS CHARACTER_MAXIMUM_LENGTH,
            COALESCE(info.NUMERIC_PRECISION, col.precision) AS NUMERIC_PRECISION,
            COALESCE(info.NUMERIC_SCALE, col.scale) AS NUMERIC_SCALE,
            COALESCE(info.DATETIME_PRECISION, col.scale) AS DATETIME_PRECISION,
            CASE WHEN col.is_nullable = 1 THEN 'YES' ELSE 'NO' END AS IS_NULLABLE,
            dc.definition AS COLUMN_DEFAULT,
            dc.name AS DEFAULT_CONSTRAINT_NAME, col.collation_name AS COLLATION_NAME,
            col.is_rowguidcol AS IS_ROWGUID, col.is_sparse AS IS_SPARSE,
            col.is_column_set AS IS_COLUMN_SET,
            computed.definition AS COMPUTED_DEFINITION,
            computed.is_persisted AS IS_PERSISTED,
            CONVERT(nvarchar(100), identity_col.seed_value) AS IDENTITY_SEED,
            CONVERT(nvarchar(100), identity_col.increment_value) AS IDENTITY_INCREMENT,
            identity_col.is_not_for_replication AS IDENTITY_NOT_FOR_REPLICATION,
            col.generated_always_type_desc AS GENERATED_ALWAYS_TYPE,
            col.is_hidden AS IS_HIDDEN,
            masked.masking_function AS MASKING_FUNCTION
       FROM sys.columns col
       JOIN sys.objects object_info ON object_info.object_id = col.object_id
       JOIN sys.schemas schema_info ON schema_info.schema_id = object_info.schema_id
       JOIN sys.types type_info ON type_info.user_type_id = col.user_type_id
       LEFT JOIN INFORMATION_SCHEMA.COLUMNS info
         ON info.TABLE_SCHEMA = schema_info.name
        AND info.TABLE_NAME = object_info.name
        AND info.COLUMN_NAME = col.name
       LEFT JOIN sys.default_constraints dc
         ON dc.parent_object_id = col.object_id
        AND dc.parent_column_id = col.column_id
       LEFT JOIN sys.computed_columns computed
         ON computed.object_id = col.object_id
        AND computed.column_id = col.column_id
       LEFT JOIN sys.identity_columns identity_col
         ON identity_col.object_id = col.object_id
        AND identity_col.column_id = col.column_id
       LEFT JOIN sys.masked_columns masked
         ON masked.object_id = col.object_id
        AND masked.column_id = col.column_id
      WHERE schema_info.name = ? AND object_info.name = ?
      ORDER BY col.column_id`,
    [sch, table],
  )
  const pkRowsPromise = objectRows<{ COLUMN_NAME: string }>(
    `SELECT col.name AS COLUMN_NAME
     FROM sys.indexes idx
     JOIN sys.objects obj ON obj.object_id = idx.object_id
     JOIN sys.schemas sch ON sch.schema_id = obj.schema_id
     JOIN sys.index_columns idx_col
       ON idx_col.object_id = idx.object_id AND idx_col.index_id = idx.index_id
     JOIN sys.columns col
       ON col.object_id = idx_col.object_id AND col.column_id = idx_col.column_id
     WHERE idx.is_primary_key = 1 AND sch.name = ? AND obj.name = ?
     ORDER BY idx_col.key_ordinal`,
    [sch, table],
  )

  const fkRowsPromise = objectRows<{
    CONSTRAINT_NAME: string
    COLUMN_NAME: string
    REF_SCHEMA: string
    REF_TABLE: string
    REF_COLUMN: string
    UPDATE_ACTION: string
    DELETE_ACTION: string
    NOT_FOR_REPLICATION: boolean
    IS_DISABLED: boolean
    IS_NOT_TRUSTED: boolean
  }>(
    `SELECT fk.name AS CONSTRAINT_NAME,
            src_col.name AS COLUMN_NAME, ref_schema.name AS REF_SCHEMA,
            ref_table.name AS REF_TABLE, ref_col.name AS REF_COLUMN,
            fk.update_referential_action_desc AS UPDATE_ACTION,
            fk.delete_referential_action_desc AS DELETE_ACTION,
            fk.is_not_for_replication AS NOT_FOR_REPLICATION,
            fk.is_disabled AS IS_DISABLED, fk.is_not_trusted AS IS_NOT_TRUSTED
     FROM sys.foreign_keys fk
     JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
     JOIN sys.tables src_table ON src_table.object_id = fk.parent_object_id
     JOIN sys.schemas src_schema ON src_schema.schema_id = src_table.schema_id
     JOIN sys.columns src_col
       ON src_col.object_id = src_table.object_id
      AND src_col.column_id = fkc.parent_column_id
     JOIN sys.tables ref_table ON ref_table.object_id = fk.referenced_object_id
     JOIN sys.schemas ref_schema ON ref_schema.schema_id = ref_table.schema_id
     JOIN sys.columns ref_col
       ON ref_col.object_id = ref_table.object_id
      AND ref_col.column_id = fkc.referenced_column_id
     WHERE src_schema.name = ? AND src_table.name = ?
     ORDER BY fk.object_id, fkc.constraint_column_id`,
    [sch, table],
  )
  const checkRowsPromise = objectRows<{
    CONSTRAINT_NAME: string
    EXPRESSION: string
    NOT_FOR_REPLICATION: boolean
    IS_DISABLED: boolean
    IS_NOT_TRUSTED: boolean
  }>(
    `SELECT checks.name AS CONSTRAINT_NAME, checks.definition AS EXPRESSION,
            checks.is_not_for_replication AS NOT_FOR_REPLICATION,
            checks.is_disabled AS IS_DISABLED,
            checks.is_not_trusted AS IS_NOT_TRUSTED
     FROM sys.check_constraints checks
     JOIN sys.tables checked_table ON checked_table.object_id = checks.parent_object_id
     JOIN sys.schemas checked_schema ON checked_schema.schema_id = checked_table.schema_id
     WHERE checked_schema.name = ? AND checked_table.name = ?
     ORDER BY checks.object_id`,
    [sch, table],
  )
  // sys.indexes + sys.index_columns + sys.columns → one row per (index, column).
  // A disabled/hypothetical index is not a usable access path. Keep live rowstore indexes,
  // including filtered indexes whose canonical predicate is exposed by sys.indexes.
  const idxRowsPromise = objectRows<{
    INDEX_NAME: string
    COLUMN_NAME: string
    KEY_ORDINAL: number
    IS_UNIQUE: boolean
    IS_PRIMARY: boolean
    IS_CONSTRAINT: boolean
    IS_INCLUDED: boolean
    IS_DESCENDING: boolean
    INDEX_COLUMN_ID: number
    INDEX_TYPE: number
    FILTER_DEFINITION: string | null
  }>(
    `SELECT i.name AS INDEX_NAME, c.name AS COLUMN_NAME, ic.key_ordinal AS KEY_ORDINAL,
            i.is_unique AS IS_UNIQUE, i.is_primary_key AS IS_PRIMARY,
            i.is_unique_constraint AS IS_CONSTRAINT,
            ic.is_included_column AS IS_INCLUDED,
            ic.is_descending_key AS IS_DESCENDING,
            ic.index_column_id AS INDEX_COLUMN_ID,
            i.type AS INDEX_TYPE,
            i.filter_definition AS FILTER_DEFINITION
     FROM sys.indexes i
     JOIN sys.objects o ON o.object_id = i.object_id
     JOIN sys.schemas s ON s.schema_id = o.schema_id
     JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
     JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
     WHERE s.name = ? AND o.name = ? AND i.type IN (1, 2)
       AND i.is_disabled = 0 AND i.is_hypothetical = 0
       AND (ic.key_ordinal > 0 OR ic.is_included_column = 1)
     ORDER BY i.name, ic.is_included_column, ic.key_ordinal, ic.index_column_id`,
    [sch, table],
  )
  const triggerRowsPromise = objectRows<{
    TRIGGER_ID: number
    TRIGGER_NAME: string
    TRIGGER_TYPE: string
    DEFINITION: string | null
    IS_DISABLED: boolean
    IS_INSTEAD_OF: boolean
    NOT_FOR_REPLICATION: boolean
    USES_ANSI_NULLS: boolean | null
    USES_QUOTED_IDENTIFIER: boolean | null
    EVENT_TYPE: string | null
    IS_FIRST: boolean | null
    IS_LAST: boolean | null
  }>(
    `SELECT trigger_info.object_id AS TRIGGER_ID,
            trigger_info.name AS TRIGGER_NAME, trigger_info.type AS TRIGGER_TYPE,
            trigger_module.definition AS DEFINITION,
            trigger_info.is_disabled AS IS_DISABLED,
            trigger_info.is_instead_of_trigger AS IS_INSTEAD_OF,
            trigger_info.is_not_for_replication AS NOT_FOR_REPLICATION,
            trigger_module.uses_ansi_nulls AS USES_ANSI_NULLS,
            trigger_module.uses_quoted_identifier AS USES_QUOTED_IDENTIFIER,
            trigger_event.type_desc AS EVENT_TYPE,
            trigger_event.is_first AS IS_FIRST, trigger_event.is_last AS IS_LAST
     FROM sys.triggers trigger_info
     JOIN sys.objects trigger_parent
       ON trigger_parent.object_id = trigger_info.parent_id
     JOIN sys.schemas trigger_schema
       ON trigger_schema.schema_id = trigger_parent.schema_id
     LEFT JOIN sys.sql_modules trigger_module
       ON trigger_module.object_id = trigger_info.object_id
     LEFT JOIN sys.trigger_events trigger_event
       ON trigger_event.object_id = trigger_info.object_id
     WHERE trigger_schema.name = ? AND trigger_parent.name = ?
       AND trigger_info.parent_class = 1
       AND trigger_info.type IN ('TR', 'TA')
       AND trigger_info.is_ms_shipped = 0
     ORDER BY trigger_info.name, trigger_event.type`,
    [sch, table],
  )
  type ClrTriggerRow = {
    TRIGGER_ID: number
    ASSEMBLY_NAME: string
    ASSEMBLY_CLASS: string
    ASSEMBLY_METHOD: string
    EXECUTE_AS_PRINCIPAL_ID: number | null
    EXECUTE_AS_NAME: string | null
  }
  // Azure SQL Database does not support CLR modules. Touch sys.assembly_modules only
  // when the universal trigger catalog actually reports a CLR trigger, so ordinary
  // T-SQL trigger browsing stays portable.
  const clrTriggerRowsPromise = triggerRowsPromise.then((triggerRows) => {
    const idSet = new Set<number>()
    for (const trigger of triggerRows) {
      const id = Number(trigger.TRIGGER_ID)
      if (trigger.TRIGGER_TYPE === 'TA' && Number.isFinite(id)) idSet.add(id)
    }
    const ids = [...idSet]
    if (ids.length === 0) return [] as ClrTriggerRow[]
    return objectRows<ClrTriggerRow>(
      `SELECT assembly_module.object_id AS TRIGGER_ID,
              assembly_info.name AS ASSEMBLY_NAME,
              assembly_module.assembly_class AS ASSEMBLY_CLASS,
              assembly_module.assembly_method AS ASSEMBLY_METHOD,
              assembly_module.execute_as_principal_id AS EXECUTE_AS_PRINCIPAL_ID,
              execute_principal.name AS EXECUTE_AS_NAME
       FROM sys.assembly_modules assembly_module
       JOIN sys.assemblies assembly_info
         ON assembly_info.assembly_id = assembly_module.assembly_id
       LEFT JOIN sys.database_principals execute_principal
         ON execute_principal.principal_id = assembly_module.execute_as_principal_id
       WHERE assembly_module.object_id IN (${ids.map(() => '?').join(', ')})`,
      ids,
    )
  })
  // sys.dm_db_partition_stats.row_count summed over the heap/clustered index
  // (index_id 0 = heap, 1 = clustered) is the maintained row estimate (no scan).
  // NULL (no partitions / view) ⇒ omit.
  const statRowsPromise = objectRows<{
    ROW_COUNT: number | string | null
    OBJECT_TYPE: string
    TEMPORAL_TYPE: number | null
    HISTORY_SCHEMA: string | null
    HISTORY_TABLE: string | null
    PERIOD_START: string | null
    PERIOD_END: string | null
  }>(
    `SELECT SUM(ps.row_count) AS ROW_COUNT, o.type AS OBJECT_TYPE,
            table_info.temporal_type AS TEMPORAL_TYPE,
            history_schema.name AS HISTORY_SCHEMA, history_table.name AS HISTORY_TABLE,
            period_start.name AS PERIOD_START, period_end.name AS PERIOD_END
     FROM sys.objects o
     JOIN sys.schemas s ON s.schema_id = o.schema_id
     LEFT JOIN sys.dm_db_partition_stats ps
       ON ps.object_id = o.object_id AND ps.index_id IN (0, 1)
     LEFT JOIN sys.tables table_info ON table_info.object_id = o.object_id
     LEFT JOIN sys.tables history_table
       ON history_table.object_id = table_info.history_table_id
     LEFT JOIN sys.schemas history_schema
       ON history_schema.schema_id = history_table.schema_id
     LEFT JOIN sys.periods period_info ON period_info.object_id = o.object_id
     LEFT JOIN sys.columns period_start
       ON period_start.object_id = period_info.object_id
      AND period_start.column_id = period_info.start_column_id
     LEFT JOIN sys.columns period_end
       ON period_end.object_id = period_info.object_id
      AND period_end.column_id = period_info.end_column_id
     WHERE s.name = ? AND o.name = ?
     GROUP BY o.type, table_info.temporal_type, history_schema.name, history_table.name,
              period_start.name, period_end.name`,
    [sch, table],
  )
  // OBJECT_DEFINITION returns NULL for encrypted modules or callers without VIEW
  // DEFINITION. sys.views still supplies the attributes needed to rebuild a current,
  // schema-qualified header when source text is visible.
  const definitionRowsPromise = objectRows<{
    DEFINITION: string | null
    IS_SCHEMA_BOUND: boolean
    HAS_VIEW_METADATA: boolean
  }>(
    `SELECT OBJECT_DEFINITION(v.object_id) AS DEFINITION,
            sm.is_schema_bound AS IS_SCHEMA_BOUND,
            v.has_opaque_metadata AS HAS_VIEW_METADATA
     FROM sys.views v
     JOIN sys.schemas s ON s.schema_id = v.schema_id
     LEFT JOIN sys.sql_modules sm ON sm.object_id = v.object_id
     WHERE s.name = ? AND v.name = ?`,
    [sch, table],
  )

  const [
    colRows,
    pkRows,
    fkRows,
    checkRows,
    idxRows,
    triggerRows,
    clrTriggerRows,
    statRows,
    definitionRows,
  ] = await Promise.all([
    colRowsPromise,
    pkRowsPromise,
    fkRowsPromise,
    checkRowsPromise,
    idxRowsPromise,
    triggerRowsPromise,
    clrTriggerRowsPromise,
    statRowsPromise,
    definitionRowsPromise,
  ])
  const pk = new Set(pkRows.map((row) => row.COLUMN_NAME))
  // SQL Server 2022 ledger tables also expose temporal metadata. Their extra generated
  // boundaries identify them without referencing the newer sys.tables.ledger_type column,
  // which would make this catalog query fail on SQL Server 2016–2019.
  const isLedger = colRows.some((column) =>
    [
      'AS_TRANSACTION_ID_START',
      'AS_TRANSACTION_ID_END',
      'AS_SEQUENCE_NUMBER_START',
      'AS_SEQUENCE_NUMBER_END',
    ].includes(column.GENERATED_ALWAYS_TYPE),
  )
  const dataType = (column: {
    DATA_TYPE: string
    CHARACTER_MAXIMUM_LENGTH: number | null
    NUMERIC_PRECISION: number | null
    NUMERIC_SCALE: number | null
    DATETIME_PRECISION: number | null
  }): string => {
    const type = column.DATA_TYPE
    const lower = type.toLowerCase()
    if (
      ['char', 'varchar', 'nchar', 'nvarchar', 'binary', 'varbinary'].includes(lower) &&
      column.CHARACTER_MAXIMUM_LENGTH !== null
    )
      return `${type}(${column.CHARACTER_MAXIMUM_LENGTH === -1 ? 'max' : column.CHARACTER_MAXIMUM_LENGTH})`
    if (
      (lower === 'decimal' || lower === 'numeric') &&
      column.NUMERIC_PRECISION !== null &&
      column.NUMERIC_SCALE !== null
    )
      return `${type}(${column.NUMERIC_PRECISION},${column.NUMERIC_SCALE})`
    if (
      (lower === 'datetime2' || lower === 'datetimeoffset' || lower === 'time') &&
      column.DATETIME_PRECISION !== null
    )
      return `${type}(${column.DATETIME_PRECISION})`
    if (lower === 'float' && column.NUMERIC_PRECISION !== null)
      return `${type}(${column.NUMERIC_PRECISION})`
    return type
  }
  const columns: DbColumn[] = colRows.map((column) => {
    const identity =
      column.IDENTITY_SEED != null && column.IDENTITY_INCREMENT != null
        ? {
            seed: String(column.IDENTITY_SEED),
            increment: String(column.IDENTITY_INCREMENT),
            notForReplication: Boolean(column.IDENTITY_NOT_FOR_REPLICATION) || undefined,
          }
        : undefined
    const generatedAlways =
      !isLedger && column.GENERATED_ALWAYS_TYPE === 'AS_ROW_START'
        ? ('ROW START' as const)
        : !isLedger && column.GENERATED_ALWAYS_TYPE === 'AS_ROW_END'
          ? ('ROW END' as const)
          : undefined
    return {
      name: column.COLUMN_NAME,
      // DATA_TYPE alone drops the length/precision that ALTER COLUMN must restate.
      // Reconstruct the server's complete type so a nullability-only edit cannot silently
      // turn NVARCHAR(255) into NVARCHAR(1), or DECIMAL(18,2) into another shape.
      dataType: dataType(column),
      nullable: column.IS_NULLABLE === 'YES',
      pk: pk.has(column.COLUMN_NAME),
      defaultValue: column.COLUMN_DEFAULT,
      defaultConstraintName: column.DEFAULT_CONSTRAINT_NAME ?? undefined,
      collation: column.COLLATION_NAME ?? undefined,
      rowGuid: Boolean(column.IS_ROWGUID) || undefined,
      sparse: Boolean(column.IS_SPARSE) || undefined,
      columnSet: Boolean(column.IS_COLUMN_SET) || undefined,
      sqlServerComputed:
        column.COMPUTED_DEFINITION != null
          ? {
              expression: column.COMPUTED_DEFINITION,
              persisted: Boolean(column.IS_PERSISTED),
            }
          : undefined,
      sqlServerIdentity: identity,
      sqlServerMaskingFunction: column.MASKING_FUNCTION ?? undefined,
      ...(generatedAlways
        ? {
            sqlServerGeneratedAlways: generatedAlways,
            ...(column.IS_HIDDEN ? { sqlServerHidden: true } : {}),
          }
        : {}),
    }
  })
  const foreignKeys = groupForeignKeyRows(
    fkRows.map((row) => ({
      id: row.CONSTRAINT_NAME,
      column: row.COLUMN_NAME,
      refSchema: row.REF_SCHEMA,
      refTable: row.REF_TABLE,
      refColumn: row.REF_COLUMN,
      onUpdate: normalizeReferentialAction(row.UPDATE_ACTION),
      onDelete: normalizeReferentialAction(row.DELETE_ACTION),
      notForReplication: Boolean(row.NOT_FOR_REPLICATION),
      disabled: Boolean(row.IS_DISABLED),
      notTrusted: Boolean(row.IS_NOT_TRUSTED),
    })),
  )
  const checkConstraints: DbCheckConstraint[] = checkRows.map((row) => ({
    name: row.CONSTRAINT_NAME,
    expression: row.EXPRESSION,
    notForReplication: Boolean(row.NOT_FOR_REPLICATION) || undefined,
    disabled: Boolean(row.IS_DISABLED) || undefined,
    notTrusted: Boolean(row.IS_NOT_TRUSTED) || undefined,
  }))
  const indexes = groupIndexRows(
    idxRows.map((row) => ({
      name: row.INDEX_NAME,
      column: row.COLUMN_NAME,
      seq: row.IS_INCLUDED ? Number(row.INDEX_COLUMN_ID) : Number(row.KEY_ORDINAL),
      unique: Boolean(row.IS_UNIQUE),
      primary: Boolean(row.IS_PRIMARY),
      constraint: Boolean(row.IS_CONSTRAINT),
      included: Boolean(row.IS_INCLUDED),
      descending: Boolean(row.IS_DESCENDING),
      clustered: Number(row.INDEX_TYPE) === 1,
      predicate: row.FILTER_DEFINITION ?? undefined,
    })),
  )
  const keyConstraints = indexes.flatMap((index) =>
    index.primary || index.constraint
      ? [
          {
            name: index.name,
            type: index.primary ? ('PRIMARY KEY' as const) : ('UNIQUE' as const),
            columns: index.columns,
            ...(index.orders ? { orders: index.orders } : {}),
            clustered: Boolean(index.clustered),
          },
        ]
      : [],
  )
  const rawRows = statRows[0]?.ROW_COUNT
  const rowCount = rawRows == null ? Number.NaN : Number(rawRows)
  const approxRows = Number.isFinite(rowCount) && rowCount >= 0 ? rowCount : undefined
  const definitionRow = definitionRows[0]
  const createScript = mssqlViewCreateScript(
    definitionRow?.DEFINITION,
    sch,
    table,
    columns,
    Boolean(definitionRow?.IS_SCHEMA_BOUND),
    Boolean(definitionRow?.HAS_VIEW_METADATA),
  )
  const statRow = statRows[0]
  const periodStart = statRow?.PERIOD_START
  const periodEnd = statRow?.PERIOD_END
  const sqlServerTemporal =
    !isLedger && periodStart && periodEnd
      ? {
          periodStart,
          periodEnd,
          systemVersioned: Number(statRow.TEMPORAL_TYPE) === 2,
          historySchema: statRow.HISTORY_SCHEMA ?? undefined,
          historyTable: statRow.HISTORY_TABLE ?? undefined,
        }
      : undefined
  const q = (name: string) => quoteIdent(name, 'mssql')
  const relationName = `${q(sch)}.${q(table)}`
  const triggerRowsById = new Map<
    number,
    {
      trigger: (typeof triggerRows)[number]
      events: Array<{ type: 'INSERT' | 'UPDATE' | 'DELETE'; first: boolean; last: boolean }>
    }
  >()
  for (const trigger of triggerRows) {
    const id = Number(trigger.TRIGGER_ID)
    if (!Number.isFinite(id) || typeof trigger.TRIGGER_NAME !== 'string') continue
    let grouped = triggerRowsById.get(id)
    if (!grouped) {
      grouped = { trigger, events: [] }
      triggerRowsById.set(id, grouped)
    }
    const event = typeof trigger.EVENT_TYPE === 'string' ? trigger.EVENT_TYPE.toUpperCase() : ''
    if (event === 'INSERT' || event === 'UPDATE' || event === 'DELETE')
      grouped.events.push({
        type: event,
        first: Boolean(trigger.IS_FIRST),
        last: Boolean(trigger.IS_LAST),
      })
  }
  const clrTriggerRowsById = new Map(
    clrTriggerRows.map((trigger) => [Number(trigger.TRIGGER_ID), trigger]),
  )
  const triggers = [...triggerRowsById.values()].map(({ trigger, events }) => {
    const name = trigger.TRIGGER_NAME
    const qualifiedTrigger = `${q(sch)}.${q(name)}`
    const clrTrigger = clrTriggerRowsById.get(Number(trigger.TRIGGER_ID))
    const canReconstructClrExecutionContext =
      clrTrigger?.EXECUTE_AS_PRINCIPAL_ID == null ||
      clrTrigger.EXECUTE_AS_PRINCIPAL_ID === -2 ||
      Boolean(clrTrigger.EXECUTE_AS_NAME)
    let triggerCreateScript =
      trigger.TRIGGER_TYPE === 'TR'
        ? mssqlTriggerCreateScript(trigger.DEFINITION, sch, table, name)
        : undefined
    if (
      trigger.TRIGGER_TYPE === 'TA' &&
      clrTrigger?.ASSEMBLY_NAME &&
      clrTrigger.ASSEMBLY_CLASS &&
      clrTrigger.ASSEMBLY_METHOD &&
      canReconstructClrExecutionContext &&
      events.length > 0
    ) {
      const executeAs =
        Number(clrTrigger.EXECUTE_AS_PRINCIPAL_ID) === -2
          ? 'OWNER'
          : clrTrigger.EXECUTE_AS_PRINCIPAL_ID != null && clrTrigger.EXECUTE_AS_NAME
            ? `N'${clrTrigger.EXECUTE_AS_NAME.replace(/'/gu, "''")}'`
            : undefined
      triggerCreateScript =
        `CREATE TRIGGER ${qualifiedTrigger}\nON ${relationName}` +
        `${executeAs ? `\nWITH EXECUTE AS ${executeAs}` : ''}\n` +
        `${trigger.IS_INSTEAD_OF ? 'INSTEAD OF' : 'AFTER'} ${events.map((event) => event.type).join(', ')}` +
        `${trigger.NOT_FOR_REPLICATION ? '\nNOT FOR REPLICATION' : ''}\n` +
        `AS EXTERNAL NAME ${q(clrTrigger.ASSEMBLY_NAME)}.${q(clrTrigger.ASSEMBLY_CLASS)}.${q(clrTrigger.ASSEMBLY_METHOD)}`
    }
    if (!triggerCreateScript)
      return {
        name,
        createScript: `-- Definition unavailable for SQL Server trigger ${qualifiedTrigger}`,
        definitionUnavailable: true,
      }

    const triggerNameLiteral = `N'${qualifiedTrigger.replace(/'/gu, "''")}'`
    const postCreateScripts: string[] = []
    for (const event of events) {
      if (event.first)
        postCreateScripts.push(
          `EXEC sys.sp_settriggerorder @triggername = ${triggerNameLiteral}, @order = N'First', @stmttype = N'${event.type}'`,
        )
      if (event.last)
        postCreateScripts.push(
          `EXEC sys.sp_settriggerorder @triggername = ${triggerNameLiteral}, @order = N'Last', @stmttype = N'${event.type}'`,
        )
    }
    if (trigger.IS_DISABLED)
      postCreateScripts.push(`DISABLE TRIGGER ${qualifiedTrigger} ON ${relationName}`)
    const preCreateScripts = [
      ...(trigger.USES_ANSI_NULLS == null
        ? []
        : [`SET ANSI_NULLS ${trigger.USES_ANSI_NULLS ? 'ON' : 'OFF'}`]),
      ...(trigger.USES_QUOTED_IDENTIFIER == null
        ? []
        : [`SET QUOTED_IDENTIFIER ${trigger.USES_QUOTED_IDENTIFIER ? 'ON' : 'OFF'}`]),
    ]
    return {
      name,
      createScript: triggerCreateScript,
      ...(preCreateScripts.length ? { preCreateScripts } : {}),
      ...(postCreateScripts.length ? { postCreateScripts } : {}),
    }
  })

  return {
    schema: sch,
    name: table,
    type: statRows[0]?.OBJECT_TYPE === 'V' ? 'view' : 'table',
    columns,
    primaryKey: [...pk],
    foreignKeys,
    checkConstraints,
    keyConstraints,
    sqlServerTemporal,
    indexes,
    ...(triggers.length ? { triggers } : {}),
    approxRows,
    createScript,
  }
}
