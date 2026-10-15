import { sqlStringLiteral } from '../shared/sql-text'
import type {
  DbCheckConstraint,
  DbColumn,
  DbExclusionConstraint,
  DbForeignKey,
  DbKeyConstraint,
  DbPostgresExtendedStatistic,
  DbPostgresPolicy,
  DbPostgresPrivilegeGrant,
  DbRule,
  DbSequenceDefinition,
  DbTableSchema,
} from './drivers/port'

/**
 * Compact, unquoted PROSE about a schema object — for a person reading a column, and for a model
 * being told what one is.
 *
 * The other half of this module renders executable SQL. These two are easy to confuse and must
 * never be: nothing here is quoted, escaped or valid to run, and a `describe*` string reaching a
 * statement builder would be a silent injection of unquoted identifiers. Keeping them in separate
 * files is the cheapest reminder of which one you are holding.
 */

/** Compact, unquoted relationship summary shared by model-facing schema consumers. */
export function describeForeignKey(foreignKey: DbForeignKey): string {
  const name = foreignKey.name ? ` ${foreignKey.name}:` : ''
  const refColumns = foreignKey.refColumns.length > 0 ? `(${foreignKey.refColumns.join(', ')})` : ''
  const attributes = [
    foreignKey.match && foreignKey.match !== 'SIMPLE' ? `MATCH ${foreignKey.match}` : '',
    foreignKey.onDelete
      ? `ON DELETE ${foreignKey.onDelete}${foreignKey.onDeleteColumns?.length ? ` (${foreignKey.onDeleteColumns.join(', ')})` : ''}`
      : '',
    foreignKey.onUpdate ? `ON UPDATE ${foreignKey.onUpdate}` : '',
    foreignKey.deferrable
      ? `DEFERRABLE INITIALLY ${foreignKey.initiallyDeferred ? 'DEFERRED' : 'IMMEDIATE'}`
      : '',
    foreignKey.validated === false ? 'NOT VALID' : '',
    foreignKey.period ? 'PERIOD' : '',
    foreignKey.enforced === false ? 'NOT ENFORCED' : '',
    foreignKey.notForReplication ? 'NOT FOR REPLICATION' : '',
    foreignKey.disabled ? 'DISABLED' : foreignKey.notTrusted ? 'NOT TRUSTED' : '',
  ].filter(Boolean)
  return `FK${name} (${foreignKey.columns.join(', ')}) → ${foreignKey.refSchema ? `${foreignKey.refSchema}.` : ''}${foreignKey.refTable}${refColumns}${attributes.length ? ` · ${attributes.join(' · ')}` : ''}`
}

/** Compact CHECK summary shared by model-facing schema consumers. */
export function describeCheckConstraint(check: DbCheckConstraint): string {
  const name = check.name ? ` ${check.name}:` : ''
  const attributes = [
    check.noInherit ? 'NO INHERIT' : '',
    check.enforced === false ? 'NOT ENFORCED' : '',
    check.validated === false ? 'NOT VALID' : '',
    check.notForReplication ? 'NOT FOR REPLICATION' : '',
    check.disabled ? 'DISABLED' : check.notTrusted ? 'NOT TRUSTED' : '',
  ].filter(Boolean)
  return `CHECK${name} ${check.expression}${attributes.length ? ` · ${attributes.join(' · ')}` : ''}`
}

/** Compact PRIMARY KEY/UNIQUE summary shared by model-facing schema consumers. */
export function describeKeyConstraint(key: DbKeyConstraint): string {
  const name = key.name ? ` ${key.name}:` : ''
  const columns = key.columns.map((column, index) =>
    key.withoutOverlaps && index === key.columns.length - 1 ? `${column} WITHOUT OVERLAPS` : column,
  )
  const attributes = [
    key.nullsNotDistinct ? 'NULLS NOT DISTINCT' : '',
    key.includeColumns?.length ? `INCLUDE (${key.includeColumns.join(', ')})` : '',
    key.deferrable
      ? `DEFERRABLE INITIALLY ${key.initiallyDeferred ? 'DEFERRED' : 'IMMEDIATE'}`
      : '',
    key.clustered === true ? 'CLUSTERED' : key.clustered === false ? 'NONCLUSTERED' : '',
  ].filter(Boolean)
  return `${key.type}${name} (${columns.join(', ')})${attributes.length ? ` · ${attributes.join(' · ')}` : ''}`
}

/** Compact PostgreSQL EXCLUDE summary shared by model-facing schema consumers. */
export function describeExclusionConstraint(exclusion: DbExclusionConstraint): string {
  const name = exclusion.name ? ` ${exclusion.name}:` : ''
  return `EXCLUSION${name} ${exclusion.definition}`
}

/** Compact column-generation summary for model-facing schema consumers. */
export function describeColumnGeneration(column: DbColumn): string {
  const sequenceDetails = (sequence: DbSequenceDefinition) => {
    const access = sequence.postgresAccess
    const grants =
      access?.grants === undefined
        ? access
          ? 'ACL DEFAULT'
          : ''
        : access.grants.length
          ? `ACL ${access.grants
              .map(
                (grant) =>
                  `${grant.privilege}${grant.grantable ? '*' : ''} TO ${grant.grantee ?? 'PUBLIC'} BY ${grant.grantor}`,
              )
              .join(', ')}`
          : 'ACL EMPTY'
    return [
      sequence.comment ? `COMMENT ${sequence.comment}` : '',
      access ? `OWNER ${access.owner}` : '',
      grants,
    ]
      .filter(Boolean)
      .map((detail) => ` · ${detail}`)
      .join('')
  }
  if (column.generated)
    return `GENERATED ALWAYS AS (${column.generated.expression}) ${column.generated.storage}`
  if (column.sqlServerComputed)
    return `AS ${column.sqlServerComputed.expression}${column.sqlServerComputed.persisted ? ' PERSISTED' : ''}`
  if (column.identity) {
    const sequence = column.identity.sequence
    const options = sequence
      ? ` · SEQUENCE ${sequence.schema}.${sequence.name} · START ${sequence.start} · INCREMENT ${sequence.increment} · CACHE ${sequence.cache}${sequence.cycle ? ' · CYCLE' : ''}${sequence.logged ? ' · LOGGED' : sequence.unlogged ? ' · UNLOGGED' : ''}${sequenceDetails(sequence)}`
      : ''
    return `GENERATED ${column.identity.generation} AS IDENTITY${options}`
  }
  if (column.ownedSequence)
    return `OWNED SEQUENCE ${column.ownedSequence.schema}.${column.ownedSequence.name}${sequenceDetails(column.ownedSequence)}`
  const attributes = [
    column.sqlServerIdentity
      ? `IDENTITY(${column.sqlServerIdentity.seed}, ${column.sqlServerIdentity.increment})${column.sqlServerIdentity.notForReplication ? ' NOT FOR REPLICATION' : ''}`
      : '',
    column.sqlServerGeneratedAlways
      ? `GENERATED ALWAYS AS ${column.sqlServerGeneratedAlways}${column.sqlServerHidden ? ' HIDDEN' : ''}`
      : '',
    column.sqlServerMaskingFunction
      ? `MASKED WITH (FUNCTION = ${sqlStringLiteral(column.sqlServerMaskingFunction)})`
      : '',
    column.rowGuid ? 'ROWGUIDCOL' : '',
    column.sparse ? 'SPARSE' : '',
    column.columnSet ? 'COLUMN_SET FOR ALL_SPARSE_COLUMNS' : '',
    column.collation ? `COLLATE ${column.collation}` : '',
  ].filter(Boolean)
  return attributes.join(' · ')
}

/** PostgreSQL 18+ identity/state carried by an otherwise ordinary NOT NULL marker. */
export function describePostgresNotNull(column: DbColumn): string {
  const constraint = column.postgresNotNull
  if (!constraint) return ''
  return [
    `CONSTRAINT ${constraint.name}`,
    constraint.noInherit ? 'NO INHERIT' : '',
    constraint.validated ? '' : 'NOT VALID',
    constraint.inherited ? 'INHERITED' : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Compact PostgreSQL persistence/storage summary for schema and resource context. */
export function describePostgresRelation(table: Pick<DbTableSchema, 'postgresRelation'>): string {
  const relation = table.postgresRelation
  if (!relation) return ''
  return [
    relation.persistence ?? '',
    relation.accessMethod ? `USING ${relation.accessMethod}` : '',
    relation.storageParameters?.length ? `WITH (${relation.storageParameters.join(', ')})` : '',
    relation.tablespace ? `TABLESPACE ${relation.tablespace}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export function describePostgresExtendedStatistic(statistic: DbPostgresExtendedStatistic): string {
  return [
    `${statistic.schema}.${statistic.name}`,
    `OWNER ${statistic.owner}`,
    statistic.statisticsTarget !== undefined ? `TARGET ${statistic.statisticsTarget}` : '',
    statistic.comment ? `COMMENT ${statistic.comment}` : '',
    statistic.createScript,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Compact PostgreSQL ownership and explicit ACL summary for schema/resource context. */
export function describePostgresAccess(table: Pick<DbTableSchema, 'postgresAccess'>): string {
  const access = table.postgresAccess
  if (!access) return ''
  const describeGrant = (grant: DbPostgresPrivilegeGrant) =>
    `${grant.privilege}${grant.grantable ? '*' : ''} TO ${grant.grantee ?? 'PUBLIC'} BY ${grant.grantor}`
  const tableAcl =
    access.tableGrants === undefined
      ? 'TABLE ACL DEFAULT'
      : access.tableGrants.length
        ? `TABLE ACL ${access.tableGrants.map(describeGrant).join(', ')}`
        : 'TABLE ACL EMPTY'
  const columns = (access.columnGrants ?? []).map(
    ({ column, grants }) =>
      `${column}: ${grants.length ? grants.map(describeGrant).join(', ') : 'EMPTY'}`,
  )
  return [`OWNER ${access.owner}`, tableAcl, columns.length ? `COLUMNS ${columns.join('; ')}` : '']
    .filter(Boolean)
    .join(' · ')
}

/** Compact PostgreSQL foreign-table dependency and table options. */
export function describePostgresForeign(table: Pick<DbTableSchema, 'postgresForeign'>): string {
  const foreign = table.postgresForeign
  if (!foreign) return ''
  const options = foreign.options?.length
    ? ` · OPTIONS (${foreign.options.map((option) => `${option.name}=${option.value}`).join(', ')})`
    : ''
  return `SERVER ${foreign.server}${options}`
}

/** Compact PostgreSQL FDW options attached to one foreign-table column. */
export function describePostgresForeignColumn(column: Pick<DbColumn, 'postgresForeignOptions'>) {
  return column.postgresForeignOptions?.length
    ? `FDW OPTIONS (${column.postgresForeignOptions
        .map((option) => `${option.name}=${option.value}`)
        .join(', ')})`
    : ''
}

/** Compact PostgreSQL column storage, collation, and planner metadata. */
export function describePostgresColumnProperties(
  column: Pick<
    DbColumn,
    | 'postgresCollation'
    | 'postgresStorage'
    | 'postgresCompression'
    | 'postgresStatistics'
    | 'postgresAttributeOptions'
  >,
): string {
  return [
    column.postgresCollation
      ? `COLLATE ${column.postgresCollation.schema}.${column.postgresCollation.name}`
      : '',
    column.postgresStorage ? `STORAGE ${column.postgresStorage}` : '',
    column.postgresCompression ? `COMPRESSION ${column.postgresCompression}` : '',
    column.postgresStatistics !== undefined ? `STATISTICS ${column.postgresStatistics}` : '',
    column.postgresAttributeOptions?.length
      ? `WITH (${column.postgresAttributeOptions
          .map((option) => `${option.name}=${option.value}`)
          .join(', ')})`
      : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Compact PostgreSQL row-level-security policy summary. */
export function describePostgresPolicy(policy: DbPostgresPolicy): string {
  const roles = policy.roles.length ? policy.roles.join(', ') : 'PUBLIC'
  return [
    `POLICY ${policy.name}`,
    policy.permissive ? 'PERMISSIVE' : 'RESTRICTIVE',
    `FOR ${policy.command}`,
    `TO ${roles}`,
    policy.using ? `USING (${policy.using})` : '',
    policy.withCheck ? `WITH CHECK (${policy.withCheck})` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Compact PostgreSQL rewrite-rule summary without duplicating its full native body. */
export function describeRule(rule: DbRule): string {
  const state = (rule.postCreateScripts ?? []).map((script) => script.trim()).join('; ')
  return `${rule.name} (native definition${state ? `; after: ${state}` : ''})`
}
