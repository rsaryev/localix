import {
  describeCheckConstraint,
  describeColumnGeneration,
  describeExclusionConstraint,
  describeForeignKey,
  describeKeyConstraint,
  describePostgresColumnProperties,
  describePostgresAccess,
  describePostgresExtendedStatistic,
  describePostgresForeign,
  describePostgresForeignColumn,
  describePostgresNotNull,
  describePostgresPolicy,
  describePostgresRelation,
  describeRule,
} from './ddl'
import type { DbIndex, DbTrigger } from './drivers/port'
import type { DbSchemaTable } from './db-schema'

/** Uniform `details` shape across every return so the tool-result type infers cleanly. */
export interface DbSchemaDetails {
  connections?: Array<{ id: string; name: string; dialect: string }>
  connection?: string
  dialect?: string
  table?: string
  columnCount?: number
  objectCount?: number
}

const MAX_NATIVE_DEFINITION_CHARS = 500

function boundedNativeDefinition(script: string): string {
  const native = script.replace(/\s+/gu, ' ').trim()
  return native.length <= MAX_NATIVE_DEFINITION_CHARS
    ? native
    : `${native.slice(0, MAX_NATIVE_DEFINITION_CHARS - 1)}…`
}

function describeIndex(index: DbIndex): string {
  const include = index.includeColumns?.length
    ? ` INCLUDE (${index.includeColumns.join(', ')})`
    : ''
  const predicate = index.predicate ? ` WHERE ${index.predicate}` : ''
  const structured = `${index.name}${index.unique ? ' UNIQUE' : ''} (${index.columns.join(', ')})${include}${predicate}`
  if (!index.createScriptOnly || !index.createScript) return structured
  return `${structured}\n    Native definition: ${boundedNativeDefinition(index.createScript)}`
}

function describeTrigger(trigger: DbTrigger): string {
  if (trigger.definitionUnavailable) return `${trigger.name}\n    Definition unavailable`
  const before = (trigger.preCreateScripts ?? [])
    .map((script) => `\n    Pre-create context: ${boundedNativeDefinition(script)}`)
    .join('')
  const after = (trigger.postCreateScripts ?? [])
    .map((script) => `\n    Post-create statement: ${boundedNativeDefinition(script)}`)
    .join('')
  return `${trigger.name}${before}\n    Native definition: ${boundedNativeDefinition(trigger.createScript)}${after}`
}

/** Format one introspected table without fetching data or changing metadata. */
export function describeSchemaTable(t: DbSchemaTable, target: { name: string; dialect: string }) {
  const pk = new Set(t.primaryKey)
  const cols = t.columns
    .map((c) => {
      const generation = describeColumnGeneration(c)
      const notNull = describePostgresNotNull(c)
      const foreignOptions = describePostgresForeignColumn(c)
      const postgresProperties = describePostgresColumnProperties(c)
      return `  ${c.name} ${c.dataType}${c.pk || pk.has(c.name) ? ' PK' : ''}${c.nullable ? '' : ' NOT NULL'}${notNull ? ` · ${notNull}` : ''}${generation ? ` · ${generation}` : ''}${foreignOptions ? ` · ${boundedNativeDefinition(foreignOptions)}` : ''}${postgresProperties ? ` · ${boundedNativeDefinition(postgresProperties)}` : ''}${c.comment ? ` · COMMENT ${boundedNativeDefinition(c.comment)}` : ''}`
    })
    .join('\n')
  const fks = t.foreignKeys.length
    ? '\nForeign keys:\n' +
      t.foreignKeys.map((foreignKey) => `  ${describeForeignKey(foreignKey)}`).join('\n')
    : ''
  const checks = t.checkConstraints?.length
    ? '\nCheck constraints:\n' +
      t.checkConstraints.map((check) => `  ${describeCheckConstraint(check)}`).join('\n')
    : ''
  const keys = t.keyConstraints?.length
    ? '\nKey constraints:\n' +
      t.keyConstraints.map((key) => `  ${describeKeyConstraint(key)}`).join('\n')
    : ''
  const exclusions = t.exclusionConstraints?.length
    ? '\nExclusion constraints:\n' +
      t.exclusionConstraints
        .map((exclusion) => `  ${describeExclusionConstraint(exclusion)}`)
        .join('\n')
    : ''
  const partitionDescriptions = [
    ...(t.postgresPartition
      ? [
          `PARTITION OF ${t.postgresPartition.parentSchema}.${t.postgresPartition.parentTable} ${t.postgresPartition.bound}`,
        ]
      : []),
    ...(t.postgresPartitionBy ? [`PARTITION BY ${t.postgresPartitionBy}`] : []),
  ]
  const partitioning = partitionDescriptions.length
    ? `\nPartitioning:\n${partitionDescriptions
        .map((description) => `  ${boundedNativeDefinition(description)}`)
        .join('\n')}`
    : ''
  const inheritance = t.postgresInheritance
    ? `\nInheritance:\n  ${boundedNativeDefinition(
        `INHERITS (${t.postgresInheritance.parents
          .map((parent) => `${parent.schema}.${parent.table}`)
          .join(', ')})`,
      )}`
    : ''
  const postgresRelation = describePostgresRelation(t)
  const relationProperties = postgresRelation
    ? `\nPostgreSQL relation:\n  ${boundedNativeDefinition(postgresRelation)}`
    : ''
  const typedTable = t.postgresOfType
    ? `\nTyped table:\n  OF ${t.postgresOfType.schema}.${t.postgresOfType.name}`
    : ''
  const postgresForeign = describePostgresForeign(t)
  const foreignTable = postgresForeign
    ? `\nForeign table:\n  ${boundedNativeDefinition(postgresForeign)}`
    : ''
  const rowSecurity = t.postgresRowSecurity
    ? `\nRow security:\n  ${t.postgresRowSecurity.enabled ? 'ENABLED' : 'DISABLED'}${t.postgresRowSecurity.forced ? ' · FORCED' : ''}${
        t.postgresRowSecurity.policies.length
          ? `\n${t.postgresRowSecurity.policies
              .map((policy) => `  ${boundedNativeDefinition(describePostgresPolicy(policy))}`)
              .join('\n')}`
          : ''
      }`
    : ''
  const replicaIdentity = t.postgresReplicaIdentity
    ? `\nReplica identity:\n  ${
        t.postgresReplicaIdentity.mode === 'INDEX'
          ? `USING INDEX ${t.postgresReplicaIdentity.index}`
          : t.postgresReplicaIdentity.mode
      }`
    : ''
  const clusteredIndex = t.postgresClusteredIndex
    ? `\nClustered index:\n  ${t.postgresClusteredIndex}`
    : ''
  const postgresAccess = describePostgresAccess(t)
  const access = postgresAccess
    ? `\nPostgreSQL access:\n  ${boundedNativeDefinition(postgresAccess)}`
    : ''
  const extendedStatistics = t.postgresExtendedStatistics?.length
    ? '\nExtended statistics:\n' +
      t.postgresExtendedStatistics
        .map(
          (statistic) =>
            `  ${boundedNativeDefinition(describePostgresExtendedStatistic(statistic))}`,
        )
        .join('\n')
    : ''
  const comment = t.comment ? `\nComment:\n  ${boundedNativeDefinition(t.comment)}` : ''
  const idx = t.indexes.length
    ? '\nIndexes:\n' + t.indexes.map((index) => `  ${describeIndex(index)}`).join('\n')
    : ''
  const rules = t.rules?.length
    ? '\nRules:\n' + t.rules.map((rule) => `  ${describeRule(rule)}`).join('\n')
    : ''
  const triggers = t.triggers?.length
    ? '\nTriggers:\n' + t.triggers.map((trigger) => `  ${describeTrigger(trigger)}`).join('\n')
    : ''
  const rows = t.approxRows !== undefined ? ` (~${t.approxRows} rows)` : ''
  const qualified = t.schema ? `${t.schema}.${t.name}` : t.name
  const details: DbSchemaDetails = {
    connection: target.name,
    dialect: target.dialect,
    table: qualified,
    columnCount: t.columns.length,
  }
  return {
    content: `${qualified} on "${target.name}" [${target.dialect}]${rows}${comment}\nColumns:\n${cols}${keys}${fks}${checks}${exclusions}${partitioning}${inheritance}${typedTable}${foreignTable}${relationProperties}${rowSecurity}${replicaIdentity}${clusteredIndex}${access}${extendedStatistics}${idx}${rules}${triggers}`,
    details,
  }
}
