import { stripStatementTerminator } from '../shared/sql-text'
import type { DbDialect, DbSequenceDefinition, DbTableSchema } from './drivers/port'
import { quoteIdent } from './sql-ident'
import {
  postgresAlterTablePrefix,
  postgresCommentLiteral,
  postgresRelationKind,
  renderIndexKeys,
} from './ddl-create-parts'
import { renderPostgresGrants } from './ddl-grants'

/**
 * The statements that follow a CREATE: comments, indexes, sequence and table state, extended
 * statistics, rules, triggers.
 *
 * Each returns an ARRAY, and that shape is the contract: a caller decides which groups it wants
 * and in what order, rather than receiving one blob it would have to split. The UI copy of this
 * module once grew explicit index statements while the server copy did not, and the agent read
 * tables with their indexes missing — one owner, composed by the caller, is the fix for that.
 */

/** PostgreSQL relation and column comments, emitted only after their target exists. */
export function buildCommentStatements(table: DbTableSchema, dialect: DbDialect): string[] {
  if (dialect !== 'postgres' || (table.type === 'view' && !table.createScript?.trim())) return []
  const q = (name: string) => quoteIdent(name, 'postgres')
  const target =
    table.postgresRelation?.persistence === 'TEMPORARY'
      ? q(table.name)
      : table.schema
        ? `${q(table.schema)}.${q(table.name)}`
        : q(table.name)
  const relationKind = postgresRelationKind(table)
  const relationComment = table.comment
    ? [`COMMENT ON ${relationKind} ${target} IS ${postgresCommentLiteral(table.comment)};`]
    : []
  const columnComments = table.columns.flatMap((column) =>
    column.comment
      ? [
          `COMMENT ON COLUMN ${target}.${q(column.name)} IS ${postgresCommentLiteral(column.comment)};`,
        ]
      : [],
  )
  return [...relationComment, ...columnComments]
}

/** Comments and explicit ACLs for identity/serial sequences owned by this relation. */
export function buildPostgresSequenceStateStatements(
  table: DbTableSchema,
  dialect: DbDialect,
): string[] {
  if (dialect !== 'postgres' || table.type === 'view') return []
  const q = (name: string) => quoteIdent(name, 'postgres')
  const sequenceByName = new Map<string, DbSequenceDefinition>()
  for (const column of table.columns) {
    const sequence = column.identity?.sequence ?? column.ownedSequence
    if (sequence) sequenceByName.set(`${sequence.schema}\u0000${sequence.name}`, sequence)
  }
  return [...sequenceByName.values()].flatMap((sequence) => {
    const target =
      table.postgresRelation?.persistence === 'TEMPORARY'
        ? `pg_temp.${q(sequence.name)}`
        : `${q(sequence.schema)}.${q(sequence.name)}`
    const comment = sequence.comment
      ? [`COMMENT ON SEQUENCE ${target} IS ${postgresCommentLiteral(sequence.comment)};`]
      : []
    const access = sequence.postgresAccess
    if (access?.grants === undefined) return comment
    return [
      ...comment,
      `REVOKE ALL PRIVILEGES ON SEQUENCE ${target} FROM ${q(access.owner)};`,
      ...renderPostgresGrants(access.grants, access.owner, target, q, 'SEQUENCE'),
    ]
  })
}

/**
 * The table's EXPLICIT (non-PK) index statements that are not already embedded in a native
 * CREATE. SQLite/PostgreSQL/SQL Server store them as separate statements; MySQL's
 * SHOW CREATE TABLE includes them and sets `createScriptIncludesIndexes`.
 */
export function buildIndexStatements(table: DbTableSchema, dialect: DbDialect): string[] {
  const q = (name: string) => quoteIdent(name, dialect)
  if (table.createScriptIncludesIndexes || (table.type === 'view' && !table.createScript?.trim()))
    return []
  const target =
    dialect === 'postgres' && table.postgresRelation?.persistence === 'TEMPORARY'
      ? `pg_temp.${q(table.name)}`
      : table.schema
        ? `${q(table.schema)}.${q(table.name)}`
        : q(table.name)
  return (table.indexes ?? []).flatMap((idx) =>
    idx.primary || idx.constraint || idx.inherited
      ? []
      : [
          idx.createScript?.trim()
            ? `${stripStatementTerminator(idx.createScript)};`
            : `CREATE ${idx.unique ? 'UNIQUE ' : ''}${dialect === 'mssql' && idx.clustered ? 'CLUSTERED ' : ''}INDEX ${q(idx.name)} ON ${target} (${renderIndexKeys(idx.columns, dialect, idx.orders, idx.prefixLengths)})${idx.includeColumns?.length ? ` INCLUDE (${idx.includeColumns.map(q).join(', ')})` : ''}${idx.predicate ? ` WHERE ${idx.predicate}` : ''};`,
        ],
  )
}

/** PostgreSQL policy, RLS, and replica-identity state that must follow index creation. */
export function buildPostgresTableStateStatements(
  table: DbTableSchema,
  dialect: DbDialect,
): string[] {
  if (dialect !== 'postgres' || table.type === 'view') return []
  const q = (name: string) => quoteIdent(name, 'postgres')
  const target =
    table.postgresRelation?.persistence === 'TEMPORARY'
      ? q(table.name)
      : table.schema
        ? `${q(table.schema)}.${q(table.name)}`
        : q(table.name)
  const alterTable = postgresAlterTablePrefix(table)
  const rowSecurity = table.postgresRowSecurity
  const policies = (rowSecurity?.policies ?? []).map((policy) => {
    const roles = policy.roles.length
      ? policy.roles.map((role) => (role === 'PUBLIC' ? 'PUBLIC' : q(role))).join(', ')
      : 'PUBLIC'
    return [
      `CREATE POLICY ${q(policy.name)} ON ${target}`,
      `AS ${policy.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'}`,
      `FOR ${policy.command}`,
      `TO ${roles}`,
      policy.using ? `USING (${policy.using})` : '',
      policy.withCheck ? `WITH CHECK (${policy.withCheck})` : '',
    ]
      .filter(Boolean)
      .join('\n')
      .concat(';')
  })
  const rowSecurityState = [
    rowSecurity?.enabled ? `${alterTable} ONLY ${target} ENABLE ROW LEVEL SECURITY;` : '',
    rowSecurity?.forced ? `${alterTable} ONLY ${target} FORCE ROW LEVEL SECURITY;` : '',
  ].filter(Boolean)
  const clusterState = table.postgresClusteredIndex
    ? [`${alterTable} ONLY ${target} CLUSTER ON ${q(table.postgresClusteredIndex)};`]
    : []
  const replicaIdentity = table.postgresReplicaIdentity
    ? [
        `${alterTable} ONLY ${target} REPLICA IDENTITY ${
          table.postgresReplicaIdentity.mode === 'INDEX'
            ? `USING INDEX ${q(table.postgresReplicaIdentity.index)}`
            : table.postgresReplicaIdentity.mode
        };`,
      ]
    : []
  return [...policies, ...rowSecurityState, ...clusterState, ...replicaIdentity]
}

/** PostgreSQL extended planner-statistics definitions and independent object state. */
export function buildPostgresExtendedStatisticsStatements(
  table: DbTableSchema,
  dialect: DbDialect,
): string[] {
  if (
    dialect !== 'postgres' ||
    (table.type === 'view' && postgresRelationKind(table) !== 'MATERIALIZED VIEW')
  )
    return []
  const q = (name: string) => quoteIdent(name, 'postgres')
  return (table.postgresExtendedStatistics ?? []).flatMap((statistic) => {
    const createScript = stripStatementTerminator(statistic.createScript)
    if (!createScript) return []
    const target =
      table.postgresRelation?.persistence === 'TEMPORARY'
        ? `pg_temp.${q(statistic.name)}`
        : `${q(statistic.schema)}.${q(statistic.name)}`
    return [
      `${createScript};`,
      ...(statistic.statisticsTarget !== undefined
        ? [`ALTER STATISTICS ${target} SET STATISTICS ${statistic.statisticsTarget};`]
        : []),
      `ALTER STATISTICS ${target} OWNER TO ${q(statistic.owner)};`,
      ...(statistic.comment
        ? [`COMMENT ON STATISTICS ${target} IS ${postgresCommentLiteral(statistic.comment)};`]
        : []),
    ]
  })
}

/** Native PostgreSQL rewrite-rule creation/state statements attached to a table or view. */
export function buildRuleStatements(table: DbTableSchema): string[] {
  if (table.type === 'view' && !table.createScript?.trim()) return []
  return (table.rules ?? []).flatMap((rule) =>
    [rule.createScript, ...(rule.postCreateScripts ?? [])].flatMap((script) => {
      const normalized = stripStatementTerminator(script)
      return normalized ? [`${normalized};`] : []
    }),
  )
}

/** Native trigger CREATE/state statements attached to a table/view, each with one terminator. */
export function buildTriggerStatements(table: DbTableSchema): string[] {
  if (table.type === 'view' && !table.createScript?.trim()) return []
  return (table.triggers ?? []).flatMap((trigger) =>
    [
      ...(trigger.preCreateScripts ?? []),
      trigger.createScript,
      ...(trigger.postCreateScripts ?? []),
    ].flatMap((script) => {
      const normalized = stripStatementTerminator(script)
      return normalized ? [`${normalized};`] : []
    }),
  )
}
