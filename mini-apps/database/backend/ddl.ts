/**
 * SQL DDL rendering for an introspected table — the ONE owner, shared by both readers of
 * a `DbTableSchema`.
 *
 * There are two, and they are not the same reader: the schema browser renders DDL for a
 * HUMAN, and the `localix://resource/db` resource expander renders it for a MODEL. They had a copy each,
 * the server one labelled "server mirror of the UI helper (can't cross the api→ui package
 * boundary)" — and they had already drifted: the UI copy grew explicit index statements and
 * the server copy did not, so the agent has been reading a table's DDL with its indexes
 * missing. Nothing failed, because a duplicated function that AGREES is invisible right up
 * until one copy moves.
 *
 * The boundary the comment cited is real but was the wrong way round: the mini app's UI already
 * imports its wire types from `../backend/contracts`, so the shared knowledge belongs HERE, in
 * the backend, where the type it renders is also declared. This module is deliberately pure —
 * types in, string out, no Node, no Hono — so the SPA bundle can carry it.
 *
 * The two renderings still differ, and that difference is now a decision a reader can SEE
 * (each caller composes the pieces it wants) rather than an accident hiding in a copy.
 */
import { sqlStringLiteral, stripStatementTerminator } from '../shared/sql-text'
import type { DbDialect, DbTableSchema } from './drivers/port'
import { quoteIdent } from './sql-ident'
import {
  mssqlColumnDefinition,
  postgresAlterTablePrefix,
  postgresColumnPropertyStatements,
  postgresCreateSequencePrefix,
  postgresCreateTablePrefix,
  postgresRelationClauses,
  postgresRelationTarget,
  postgresSequenceOptions,
  reconstructPostgresPartition,
  renderForeignKey,
  renderIndexKeys,
  renderKeyConstraint,
  renderPostgresAlterForeignOptions,
  renderPostgresForeignOptions,
  renderPostgresNotNullConstraint,
  postgresColumnGeneration,
  renderCheckConstraint,
  postgresForeignClauses,
} from './ddl-create-parts'

/**
 * ---
 *
 * This file WAS all of it — 1,181 lines. The pieces now live beside it by the KIND of work they
 * do (prose vs. clauses vs. grants vs. follow-up statements), and this stays as the door: a dozen
 * modules import `./ddl` by name, and the module's identity is "how a table becomes SQL", not any
 * one of those four.
 */
export {
  describeCheckConstraint,
  describeColumnGeneration,
  describeExclusionConstraint,
  describeForeignKey,
  describeKeyConstraint,
  describePostgresAccess,
  describePostgresColumnProperties,
  describePostgresExtendedStatistic,
  describePostgresForeign,
  describePostgresForeignColumn,
  describePostgresNotNull,
  describePostgresPolicy,
  describePostgresRelation,
  describeRule,
} from './ddl-describe'
export { buildPostgresAccessStatements } from './ddl-grants'
export {
  buildCommentStatements,
  buildIndexStatements,
  buildPostgresExtendedStatisticsStatements,
  buildPostgresSequenceStateStatements,
  buildPostgresTableStateStatements,
  buildRuleStatements,
  buildTriggerStatements,
} from './ddl-statements'

/**
 * Reconstruct a clean `CREATE TABLE` from columns + PK + FKs. Used when the engine has no
 * verbatim script of its own to hand back. View columns do not contain the defining SELECT,
 * so a missing view script is reported honestly instead of fabricating executable DDL.
 *
 * Every NAME is quoted for the dialect; `dataType` and `defaultValue` are NOT — those are
 * SQL text the engine handed back (`character varying(255)`, `now()`), not identifiers.
 */
export function reconstructCreate(table: DbTableSchema, dialect: DbDialect): string {
  const q = (name: string) => quoteIdent(name, dialect)
  const qualify = (schema: string | undefined, name: string) =>
    schema
      ? dialect === 'postgres' &&
        table.postgresRelation?.persistence === 'TEMPORARY' &&
        schema === table.schema
        ? `pg_temp.${q(name)}`
        : `${q(schema)}.${q(name)}`
      : q(name)
  const target =
    dialect === 'postgres'
      ? postgresRelationTarget(table, q, qualify)
      : qualify(table.schema, table.name)
  if (table.type === 'view') return `-- Definition unavailable for view ${target}.`
  if (dialect === 'postgres' && table.postgresPartition)
    return reconstructPostgresPartition(table, q, qualify)

  const postgresOfType = dialect === 'postgres' ? table.postgresOfType : undefined
  const inheritance = dialect === 'postgres' ? table.postgresInheritance : undefined
  const localColumns = inheritance ? new Set(inheritance.localColumns) : undefined
  const shouldEmitConstraint = (constraint: { inherited?: boolean }) =>
    !inheritance || !constraint.inherited
  const structuredPrimary = table.keyConstraints
    ?.filter(shouldEmitConstraint)
    .find((key) => key.type === 'PRIMARY KEY')
  const composite = table.primaryKey.length > 1 || structuredPrimary !== undefined
  const beforeCreate: string[] = []
  const afterCreate: string[] = []
  const createdSequences = new Set<string>()
  const alterTable = dialect === 'postgres' ? postgresAlterTablePrefix(table) : 'ALTER TABLE'
  const cols = table.columns.flatMap((c) => {
    if (localColumns && !localColumns.has(c.name)) return []
    if (dialect === 'mssql') return mssqlColumnDefinition(c, composite)
    const pk = !composite && c.pk ? ' PRIMARY KEY' : ''
    const structuredNotNull =
      dialect === 'postgres' ? renderPostgresNotNullConstraint(c, q, false) : undefined
    const deferNotNull = structuredNotNull && c.postgresNotNull?.validated === false
    const nn = c.nullable
      ? ''
      : structuredNotNull
        ? deferNotNull
          ? ''
          : ` ${structuredNotNull}`
        : ' NOT NULL'
    const generation = dialect === 'postgres' ? postgresColumnGeneration(c, qualify) : ''
    const foreignOptions =
      dialect === 'postgres' ? renderPostgresForeignOptions(c.postgresForeignOptions, q) : ''
    const postgresCollation =
      dialect === 'postgres' && !postgresOfType && c.postgresCollation
        ? ` COLLATE ${qualify(c.postgresCollation.schema, c.postgresCollation.name)}`
        : ''
    let defaultExpression = c.defaultValue
    if (dialect === 'postgres' && c.ownedSequence) {
      const sequence = c.ownedSequence
      const sequenceName = qualify(sequence.schema, sequence.name)
      beforeCreate.push(
        `${postgresCreateSequencePrefix(table, sequence)} ${sequenceName} ${postgresSequenceOptions(sequence, qualify, false)};`,
      )
      createdSequences.add(sequenceName)
      defaultExpression = `nextval(${sqlStringLiteral(sequenceName)}::regclass)`
      afterCreate.push(`ALTER SEQUENCE ${sequenceName} OWNED BY ${target}.${q(c.name)};`)
    }
    if (deferNotNull)
      afterCreate.push(`${alterTable} ${target} ADD ${structuredNotNull} ${q(c.name)} NOT VALID;`)
    const def = !generation && defaultExpression != null ? ` DEFAULT ${defaultExpression}` : ''
    if (postgresOfType) {
      const options = `${generation}${pk}${nn}${def}`
      return options ? `  ${q(c.name)} WITH OPTIONS${options}` : ''
    }
    return [
      `  ${q(c.name)} ${c.dataType}${foreignOptions ? ` ${foreignOptions}` : ''}${postgresCollation}${generation}${pk}${nn}${def}`,
    ]
  })
  if (dialect === 'postgres')
    afterCreate.push(...postgresColumnPropertyStatements(table, target, q))
  if (dialect === 'postgres' && inheritance && table.postgresForeign) {
    for (const column of table.columns.filter((candidate) => !localColumns?.has(candidate.name))) {
      const options = renderPostgresAlterForeignOptions(column.postgresForeignOptions, q)
      if (options)
        afterCreate.push(`${alterTable} ${target} ALTER COLUMN ${q(column.name)} ${options};`)
    }
  }
  for (const override of inheritance?.defaultOverrides ?? []) {
    const column = table.columns.find((candidate) => candidate.name === override.column)
    const sequence = column?.ownedSequence
    let defaultValue = override.value?.trim()
    if (sequence && defaultValue) {
      const sequenceName = qualify(sequence.schema, sequence.name)
      if (!createdSequences.has(sequenceName)) {
        beforeCreate.push(
          `${postgresCreateSequencePrefix(table, sequence)} ${sequenceName} ${postgresSequenceOptions(sequence, qualify, false)};`,
        )
        createdSequences.add(sequenceName)
      }
      defaultValue = `nextval(${sqlStringLiteral(sequenceName)}::regclass)`
    }
    const action = defaultValue ? `SET DEFAULT ${defaultValue}` : 'DROP DEFAULT'
    afterCreate.push(`${alterTable} ONLY ${target} ALTER COLUMN ${q(override.column)} ${action};`)
    if (sequence && defaultValue) {
      const sequenceName = qualify(sequence.schema, sequence.name)
      afterCreate.push(`ALTER SEQUENCE ${sequenceName} OWNED BY ${target}.${q(override.column)};`)
    }
  }
  for (const columnName of inheritance?.notNullColumns ?? []) {
    const column = table.columns.find((candidate) => candidate.name === columnName)
    const constraint = column && renderPostgresNotNullConstraint(column, q, true)
    if (constraint) {
      const validation = column.postgresNotNull?.validated === false ? ' NOT VALID' : ''
      afterCreate.push(`${alterTable} ONLY ${target} ADD ${constraint}${validation};`)
    } else {
      afterCreate.push(`${alterTable} ONLY ${target} ALTER COLUMN ${q(columnName)} SET NOT NULL;`)
    }
  }
  const constraints: string[] = []
  if (table.keyConstraints !== undefined) {
    if (!structuredPrimary && table.primaryKey.length > 1)
      constraints.push(`  PRIMARY KEY (${table.primaryKey.map(q).join(', ')})`)
    for (const key of table.keyConstraints.filter(shouldEmitConstraint))
      constraints.push(`  ${renderKeyConstraint(key, dialect)}`)
  } else {
    if (composite) constraints.push(`  PRIMARY KEY (${table.primaryKey.map(q).join(', ')})`)
    for (const index of table.indexes) {
      if (index.constraint && index.unique && !index.primary)
        constraints.push(
          `  UNIQUE${dialect === 'mssql' && index.clustered ? ' CLUSTERED' : ''} (${renderIndexKeys(index.columns, dialect, index.orders, index.prefixLengths)})`,
        )
    }
  }
  for (const check of (table.checkConstraints ?? []).filter(shouldEmitConstraint)) {
    const definition = renderCheckConstraint(check, dialect)
    if (dialect === 'postgres' && check.validated === false)
      afterCreate.push(`${alterTable} ${target} ADD ${definition} NOT VALID;`)
    else constraints.push(`  ${definition}`)

    if (dialect === 'mssql' && check.name) {
      if (check.disabled)
        afterCreate.push(`ALTER TABLE ${target} NOCHECK CONSTRAINT ${q(check.name)};`)
      else if (check.notTrusted)
        afterCreate.push(
          `ALTER TABLE ${target} NOCHECK CONSTRAINT ${q(check.name)};`,
          `ALTER TABLE ${target} CHECK CONSTRAINT ${q(check.name)};`,
        )
    }
  }
  for (const exclusion of (table.exclusionConstraints ?? []).filter(shouldEmitConstraint)) {
    const name = exclusion.name ? `CONSTRAINT ${q(exclusion.name)} ` : ''
    constraints.push(`  ${name}${exclusion.definition.trim()}`)
  }
  if (dialect === 'mssql' && table.sqlServerTemporal)
    constraints.push(
      `  PERIOD FOR SYSTEM_TIME (${q(table.sqlServerTemporal.periodStart)}, ${q(table.sqlServerTemporal.periodEnd)})`,
    )
  for (const fk of table.foreignKeys.filter(shouldEmitConstraint)) {
    const definition = renderForeignKey(fk, dialect, qualify)
    if (dialect === 'postgres' && fk.validated === false)
      afterCreate.push(`${alterTable} ${target} ADD ${definition} NOT VALID;`)
    else constraints.push(`  ${definition}`)

    if (dialect === 'mssql' && fk.name) {
      if (fk.disabled) afterCreate.push(`ALTER TABLE ${target} NOCHECK CONSTRAINT ${q(fk.name)};`)
      else if (fk.notTrusted)
        afterCreate.push(
          `ALTER TABLE ${target} NOCHECK CONSTRAINT ${q(fk.name)};`,
          `ALTER TABLE ${target} CHECK CONSTRAINT ${q(fk.name)};`,
        )
    }
  }
  const temporal = dialect === 'mssql' ? table.sqlServerTemporal : undefined
  const historyTarget =
    temporal?.historyTable !== undefined
      ? qualify(temporal.historySchema, temporal.historyTable)
      : undefined
  const postgresInheritance = inheritance
    ? `\nINHERITS (${inheritance.parents
        .map((parent) => qualify(parent.schema, parent.table))
        .join(', ')})`
    : ''
  const postgresPartitionBy =
    dialect === 'postgres' && table.postgresPartitionBy?.trim()
      ? `\nPARTITION BY ${stripStatementTerminator(table.postgresPartitionBy)}`
      : ''
  const postgresPhysical = dialect === 'postgres' ? postgresRelationClauses(table, q) : ''
  const postgresForeign = dialect === 'postgres' ? postgresForeignClauses(table, q) : ''
  const createSuffix = temporal?.systemVersioned
    ? `\nWITH (SYSTEM_VERSIONING = ON${historyTarget ? ` (HISTORY_TABLE = ${historyTarget})` : ''});`
    : `${postgresInheritance}${postgresPartitionBy}${postgresPhysical}${postgresForeign};`
  const createPrefix = dialect === 'postgres' ? postgresCreateTablePrefix(table) : 'CREATE TABLE'
  const createItems = [...cols, ...constraints].filter(Boolean)
  const typedDefinition = postgresOfType
    ? ` OF ${qualify(postgresOfType.schema, postgresOfType.name)}${
        createItems.length ? ` (\n${createItems.join(',\n')}\n)` : ''
      }`
    : ` (\n${createItems.join(',\n')}\n)`
  const create = `${createPrefix} ${target}${typedDefinition}${createSuffix}`
  return [
    ...beforeCreate,
    create,
    ...(afterCreate.length > 0 ? [afterCreate.join('\n')] : []),
  ].join('\n\n')
}

/**
 * Full CREATE for one table: prefer the engine's stored `createScript` (sqlite keeps it
 * verbatim; MySQL's canonical statement also embeds its indexes), else reconstruct one.
 * Callers compose {@link buildIndexStatements} after this; it skips indexes already present
 * in a native CREATE as well as the PRIMARY KEY's implicit index.
 */
export function buildTableDDL(table: DbTableSchema, dialect: DbDialect): string {
  const script = table.createScript?.trim()
  return script ? script : reconstructCreate(table, dialect)
}
