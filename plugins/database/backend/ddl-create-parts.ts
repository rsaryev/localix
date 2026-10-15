import { sqlStringLiteral, stripStatementTerminator } from '../shared/sql-text'
import type {
  DbColumn,
  DbPostgresOption,
  DbSequenceDefinition,
  DbTableSchema,
} from './drivers/port'
import { quoteIdent } from './sql-ident'
import { renderForeignKey, renderCheckConstraint, renderKeyConstraint } from './ddl-constraints'

export {
  renderIndexKeys,
  renderForeignKey,
  renderCheckConstraint,
  renderKeyConstraint,
} from './ddl-constraints'

/**
 * The clauses a CREATE statement is assembled from — one renderer per fragment.
 *
 * Every one of these quotes its identifiers through `quoteIdent` and returns a piece of runnable
 * SQL. They are separate functions rather than one big template because the two callers compose
 * DIFFERENT subsets: the schema browser wants the whole statement, the resource expander wants a
 * table a model can read. That difference is a decision each caller makes, visibly, out of these.
 */

export function renderPostgresNotNullConstraint(
  column: DbColumn,
  q: (name: string) => string,
  tableLevel: boolean,
): string | undefined {
  const constraint = column.postgresNotNull
  if (!constraint || constraint.inherited) return undefined
  const subject = tableLevel ? ` ${q(column.name)}` : ''
  return `CONSTRAINT ${q(constraint.name)} NOT NULL${subject}${constraint.noInherit ? ' NO INHERIT' : ''}`
}

export function postgresRelationTarget(
  table: DbTableSchema,
  q: (name: string) => string,
  qualify: (schema: string | undefined, name: string) => string,
): string {
  return table.postgresRelation?.persistence === 'TEMPORARY'
    ? q(table.name)
    : qualify(table.schema, table.name)
}

export function postgresCreateTablePrefix(table: DbTableSchema): string {
  if (table.postgresForeign) return 'CREATE FOREIGN TABLE'
  const persistence = table.postgresRelation?.persistence
  return `CREATE${persistence ? ` ${persistence}` : ''} TABLE`
}

export function postgresCreateSequencePrefix(
  table: DbTableSchema,
  sequence: DbSequenceDefinition,
): string {
  const persistence =
    table.postgresRelation?.persistence === 'TEMPORARY'
      ? ' TEMPORARY'
      : sequence.unlogged
        ? ' UNLOGGED'
        : ''
  return `CREATE${persistence} SEQUENCE`
}

export function postgresAlterTablePrefix(table: DbTableSchema): string {
  return table.postgresForeign ? 'ALTER FOREIGN TABLE' : 'ALTER TABLE'
}

export function postgresColumnPropertyStatements(
  table: DbTableSchema,
  target: string,
  q: (name: string) => string,
): string[] {
  const alterTable = postgresAlterTablePrefix(table)
  return table.columns.flatMap((column) => {
    const columnTarget = `${alterTable} ONLY ${target} ALTER COLUMN ${q(column.name)}`
    return [
      column.postgresStorage ? `${columnTarget} SET STORAGE ${column.postgresStorage};` : '',
      column.postgresCompression
        ? `${columnTarget} SET COMPRESSION ${q(column.postgresCompression)};`
        : '',
      column.postgresStatistics !== undefined
        ? `${columnTarget} SET STATISTICS ${column.postgresStatistics};`
        : '',
      column.postgresAttributeOptions?.length
        ? `${columnTarget} SET (${column.postgresAttributeOptions
            .map((option) => `${q(option.name)} = ${option.value}`)
            .join(', ')});`
        : '',
    ].filter(Boolean)
  })
}

export function renderPostgresForeignOptions(
  options: DbPostgresOption[] | undefined,
  q: (name: string) => string,
): string {
  if (!options?.length) return ''
  return `OPTIONS (${options
    .map((option) => `${q(option.name)} ${sqlStringLiteral(option.value)}`)
    .join(', ')})`
}

export function renderPostgresAlterForeignOptions(
  options: DbPostgresOption[] | undefined,
  q: (name: string) => string,
): string {
  if (!options?.length) return ''
  return `OPTIONS (${options
    .map((option) => `ADD ${q(option.name)} ${sqlStringLiteral(option.value)}`)
    .join(', ')})`
}

export function postgresForeignClauses(table: DbTableSchema, q: (name: string) => string): string {
  const foreign = table.postgresForeign
  if (!foreign) return ''
  const options = renderPostgresForeignOptions(foreign.options, q)
  return `\nSERVER ${q(foreign.server)}${options ? `\n${options}` : ''}`
}

export function postgresRelationClauses(table: DbTableSchema, q: (name: string) => string): string {
  const relation = table.postgresRelation
  if (!relation) return ''
  return [
    relation.accessMethod ? `USING ${q(relation.accessMethod)}` : '',
    relation.storageParameters?.length ? `WITH (${relation.storageParameters.join(', ')})` : '',
    relation.tablespace ? `TABLESPACE ${q(relation.tablespace)}` : '',
  ]
    .filter(Boolean)
    .map((clause) => `\n${clause}`)
    .join('')
}

export function postgresSequenceOptions(
  sequence: DbSequenceDefinition,
  qualify: (schema: string | undefined, name: string) => string,
  includeName: boolean,
): string {
  return [
    includeName ? `SEQUENCE NAME ${qualify(sequence.schema, sequence.name)}` : '',
    includeName ? '' : `AS ${sequence.dataType}`,
    `INCREMENT BY ${sequence.increment}`,
    `MINVALUE ${sequence.minValue}`,
    `MAXVALUE ${sequence.maxValue}`,
    sequence.cycle ? 'CYCLE' : 'NO CYCLE',
    `START WITH ${sequence.start}`,
    `CACHE ${sequence.cache}`,
    includeName && sequence.logged ? 'LOGGED' : '',
    includeName && !sequence.logged && sequence.unlogged ? 'UNLOGGED' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export function postgresColumnGeneration(
  column: DbColumn,
  qualify: (schema: string | undefined, name: string) => string,
): string {
  if (column.generated)
    return ` GENERATED ALWAYS AS (${column.generated.expression}) ${column.generated.storage}`
  if (column.identity) {
    const options = column.identity.sequence
      ? ` (${postgresSequenceOptions(column.identity.sequence, qualify, true)})`
      : ''
    return ` GENERATED ${column.identity.generation} AS IDENTITY${options}`
  }
  return ''
}

export function mssqlColumnDefinition(column: DbColumn, composite: boolean): string {
  const q = (name: string) => quoteIdent(name, 'mssql')
  const pk = !composite && column.pk ? ' PRIMARY KEY' : ''
  if (column.columnSet) return `  ${q(column.name)} XML COLUMN_SET FOR ALL_SPARSE_COLUMNS${pk}`
  if (column.sqlServerComputed) {
    const persisted = column.sqlServerComputed.persisted ? ' PERSISTED' : ''
    const nn = column.sqlServerComputed.persisted && !column.nullable ? ' NOT NULL' : ''
    return `  ${q(column.name)} AS ${column.sqlServerComputed.expression}${persisted}${nn}${pk}`
  }

  const collation = column.collation ? ` COLLATE ${column.collation}` : ''
  const sparse = column.sparse ? ' SPARSE' : ''
  const mask = column.sqlServerMaskingFunction
    ? ` MASKED WITH (FUNCTION = ${sqlStringLiteral(column.sqlServerMaskingFunction)})`
    : ''
  const constraint = column.defaultConstraintName
    ? `CONSTRAINT ${q(column.defaultConstraintName)} `
    : ''
  const def = column.defaultValue != null ? ` ${constraint}DEFAULT ${column.defaultValue}` : ''
  const identity = column.sqlServerIdentity
    ? ` IDENTITY(${column.sqlServerIdentity.seed}, ${column.sqlServerIdentity.increment})${column.sqlServerIdentity.notForReplication ? ' NOT FOR REPLICATION' : ''}`
    : ''
  const generatedAlways = column.sqlServerGeneratedAlways
    ? ` GENERATED ALWAYS AS ${column.sqlServerGeneratedAlways}${column.sqlServerHidden ? ' HIDDEN' : ''}`
    : ''
  const nn = column.nullable ? ' NULL' : ' NOT NULL'
  const rowGuid = column.rowGuid ? ' ROWGUIDCOL' : ''
  return `  ${q(column.name)} ${column.dataType}${collation}${sparse}${mask}${def}${identity}${generatedAlways}${nn}${rowGuid}${pk}`
}

export function reconstructPostgresPartition(
  table: DbTableSchema,
  q: (name: string) => string,
  qualify: (schema: string | undefined, name: string) => string,
): string {
  const partition = table.postgresPartition!
  const target = postgresRelationTarget(table, q, qualify)
  const parent = qualify(partition.parentSchema, partition.parentTable)
  const bound = stripStatementTerminator(partition.bound)
  const partitionBy = table.postgresPartitionBy?.trim().replace(/;+\s*$/u, '')
  const create = `${postgresCreateTablePrefix(table)} ${target} PARTITION OF ${parent}\n${bound}${partitionBy ? `\nPARTITION BY ${partitionBy}` : ''}${postgresRelationClauses(table, q)}${postgresForeignClauses(table, q)};`
  const beforeCreate: string[] = []
  const afterCreate: string[] = []
  const createdSequences = new Set<string>()
  const alterTable = postgresAlterTablePrefix(table)

  afterCreate.push(...postgresColumnPropertyStatements(table, target, q))
  for (const column of table.columns) {
    const options = renderPostgresAlterForeignOptions(column.postgresForeignOptions, q)
    if (options)
      afterCreate.push(`${alterTable} ${target} ALTER COLUMN ${q(column.name)} ${options};`)
  }

  for (const override of partition.defaultOverrides ?? []) {
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
  for (const columnName of partition.notNullColumns ?? []) {
    const column = table.columns.find((candidate) => candidate.name === columnName)
    const constraint = column && renderPostgresNotNullConstraint(column, q, true)
    if (constraint) {
      const validation = column.postgresNotNull?.validated === false ? ' NOT VALID' : ''
      afterCreate.push(`${alterTable} ONLY ${target} ADD ${constraint}${validation};`)
    } else {
      afterCreate.push(`${alterTable} ONLY ${target} ALTER COLUMN ${q(columnName)} SET NOT NULL;`)
    }
  }
  for (const key of (table.keyConstraints ?? []).filter((constraint) => !constraint.inherited))
    afterCreate.push(`${alterTable} ONLY ${target} ADD ${renderKeyConstraint(key, 'postgres')};`)
  for (const check of (table.checkConstraints ?? []).filter(
    (constraint) => !constraint.inherited,
  )) {
    const validation = check.validated === false ? ' NOT VALID' : ''
    afterCreate.push(
      `${alterTable} ONLY ${target} ADD ${renderCheckConstraint(check, 'postgres')}${validation};`,
    )
  }
  for (const exclusion of (table.exclusionConstraints ?? []).filter(
    (constraint) => !constraint.inherited,
  )) {
    const name = exclusion.name ? `CONSTRAINT ${q(exclusion.name)} ` : ''
    afterCreate.push(`${alterTable} ONLY ${target} ADD ${name}${exclusion.definition.trim()};`)
  }
  for (const foreignKey of table.foreignKeys.filter((constraint) => !constraint.inherited)) {
    const validation = foreignKey.validated === false ? ' NOT VALID' : ''
    afterCreate.push(
      `${alterTable} ONLY ${target} ADD ${renderForeignKey(foreignKey, 'postgres', qualify)}${validation};`,
    )
  }

  return [...beforeCreate, create, ...afterCreate].join('\n\n')
}

export function postgresRelationKind(table: DbTableSchema): string {
  if (table.type === 'view')
    return /^\s*CREATE\s+MATERIALIZED\s+VIEW\b/iu.test(table.createScript ?? '')
      ? 'MATERIALIZED VIEW'
      : 'VIEW'
  return table.postgresForeign ? 'FOREIGN TABLE' : 'TABLE'
}

export function postgresCommentLiteral(value: string): string {
  return `E'${value.replace(/\\/gu, '\\\\').replace(/'/gu, "''")}'`
}
