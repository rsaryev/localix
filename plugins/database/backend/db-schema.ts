import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import { getDatabaseDriverManifest, isDatabaseDialect } from '../shared/driver-catalog'
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
import type {
  DbCheckConstraint,
  DbColumn,
  DbExclusionConstraint,
  DbForeignKey,
  DbIndex,
  DbKeyConstraint,
  DbRule,
  DbTableSchema,
  DbTrigger,
} from './drivers/port'

/**
 * Narrow port for schema DISCOVERY — the `database_client` tool's `schema` verb. The plugin's
 * `register()` (backend/index.ts) adapts the shared service to it, so the tool depends
 * only on this shape. Introspection only: never connection URLs or credentials.
 */
export type DbSchemaColumn = DbColumn
export interface DbSchemaTable {
  schema?: string
  name: string
  type: string
  comment?: string
  columns: DbSchemaColumn[]
  primaryKey: string[]
  foreignKeys: DbForeignKey[]
  checkConstraints?: DbCheckConstraint[]
  keyConstraints?: DbKeyConstraint[]
  exclusionConstraints?: DbExclusionConstraint[]
  postgresPartitionBy?: string
  postgresPartition?: DbTableSchema['postgresPartition']
  postgresInheritance?: DbTableSchema['postgresInheritance']
  postgresRelation?: DbTableSchema['postgresRelation']
  postgresOfType?: DbTableSchema['postgresOfType']
  postgresForeign?: DbTableSchema['postgresForeign']
  postgresRowSecurity?: DbTableSchema['postgresRowSecurity']
  postgresReplicaIdentity?: DbTableSchema['postgresReplicaIdentity']
  postgresClusteredIndex?: string
  postgresExtendedStatistics?: DbTableSchema['postgresExtendedStatistics']
  postgresAccess?: DbTableSchema['postgresAccess']
  indexes: DbIndex[]
  triggers?: DbTrigger[]
  rules?: DbRule[]
  approxRows?: number
}
export interface DbSchemaPort {
  listConnections(
    userId: string,
  ): Promise<
    Array<{ id: string; name: string; dialect: string; connected: boolean; readonly: boolean }>
  >
  /** schemaName → its objects (SQL: tables/views; non-SQL: collections/indices/keyspaces). */
  schemas(
    userId: string,
    connectionId: string,
  ): Promise<Record<string, Array<{ name: string; type: string }>> | null>
  tableSchema(
    userId: string,
    connectionId: string,
    schema: string | undefined,
    table: string,
  ): Promise<DbSchemaTable | null>
}

export interface DbSchemaToolOptions {
  userId: string
  port: DbSchemaPort
}

/** Uniform `details` shape across every return so the tool-result type infers cleanly. */
interface DbSchemaDetails {
  connections?: Array<{ id: string; name: string; dialect: string }>
  connection?: string
  dialect?: string
  table?: string
  columnCount?: number
  objectCount?: number
}

const inputSchema = z.object({
  connection_id: z
    .string()
    .optional()
    .describe(
      'Omit to list the connected databases. Pass a connection id to browse that database.',
    ),
  table: z
    .string()
    .optional()
    .describe(
      'With connection_id, describe this table/collection (columns, primary key, foreign keys, indexes, triggers).',
    ),
  schema: z
    .string()
    .optional()
    .describe('Optional schema/namespace that qualifies `table` (e.g. `public`).'),
})

/** Objects listed per schema before truncating, to keep the result token-bounded. */
const MAX_OBJECTS = 200
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

/** Describe the databases the user has connected, and browse a connection's schema —
 *  the `database_client` tool's read-only `schema` verb (introspection only; no credentials). Its own
 *  name and description are internal: the model sees `database-tool-schema.ts`. */
export function createDbSchemaTool(options: DbSchemaToolOptions) {
  return defineAgentTool({
    name: 'db_schema',
    activeVerb: 'Reading database schema',
    description:
      'Discover the structure of databases the user connected in the Database workbench (SQL and non-SQL alike). ' +
      "Call with no arguments to list the connections; with connection_id to list that database's tables/views " +
      "(or a non-SQL engine's collections/indices/keyspaces); with connection_id + table to describe one table's " +
      'columns, primary key, foreign keys, indexes and triggers. Read-only introspection — never returns credentials. Use it ' +
      'to learn the schema before writing a db_query.',
    inputSchema,
    executionMode: 'parallel',
    // Silence would classify introspection as `external` (an undeclared tool is unknown).
    mutates: false,
    async execute(_toolCallId, input) {
      const conns = await options.port.listConnections(options.userId)
      const live = conns.filter((c) => c.connected)

      // ── Mode 1: roster ──────────────────────────────────────────────────
      if (!input.connection_id) {
        // An empty roster is an answer, not a failed call: the call was right, and the list is empty.
        if (live.length === 0) {
          return {
            content:
              'No database is connected. See saved ones with action="connections" and reopen one with action="reconnect", or add one with action="connect".',
          }
        }
        const lines = live.map((c) => {
          const manifest = isDatabaseDialect(c.dialect)
            ? getDatabaseDriverManifest(c.dialect)
            : null
          return `- ${c.name} [${c.dialect}]${manifest ? ` · ${manifest.label} · ${manifest.kind}` : ''}${c.readonly ? ' (read-only)' : ''} — id: ${c.id}`
        })
        const details: DbSchemaDetails = {
          connections: live.map((c) => ({ id: c.id, name: c.name, dialect: c.dialect })),
        }
        return {
          content: `${live.length} connected database(s):\n${lines.join('\n')}\n\nPass a connection_id to browse its schema.`,
          details,
        }
      }

      const target = conns.find((c) => c.id === input.connection_id)
      if (!target) {
        const opts = live.map((c) => `${c.name} (${c.id})`).join(', ')
        return {
          content: `No connected database with id "${input.connection_id}". Connected: ${opts || '(none)'}.`,
          isError: true,
        }
      }
      if (!target.connected) {
        return {
          content: `"${target.name}" is not connected. Reopen it with action="reconnect" and connection_id "${target.id}".`,
          isError: true,
        }
      }

      // ── Mode 3: one table's detail ──────────────────────────────────────
      if (input.table) {
        let t: DbSchemaTable | null
        try {
          t = await options.port.tableSchema(options.userId, target.id, input.schema, input.table)
        } catch (err) {
          return {
            content: `Could not read "${input.table}": ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
        if (!t) return { content: 'Connection not found or disconnected.', isError: true }
        if (t.columns.length === 0) {
          const details: DbSchemaDetails = {
            connection: target.name,
            dialect: target.dialect,
            table: input.table,
          }
          return {
            content: `"${input.table}" on "${target.name}" [${target.dialect}] has no column metadata (this engine is schemaless) — sample it with action="browse".`,
            details,
          }
        }
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
          ? '\nTriggers:\n' +
            t.triggers.map((trigger) => `  ${describeTrigger(trigger)}`).join('\n')
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

      // ── Mode 2: schema tree ─────────────────────────────────────────────
      let map: Record<string, Array<{ name: string; type: string }>> | null
      try {
        map = await options.port.schemas(options.userId, target.id)
      } catch (err) {
        return {
          content: `Could not read schema: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        }
      }
      if (!map) return { content: 'Connection not found or disconnected.', isError: true }

      const schemaNames = Object.keys(map)
      const total = schemaNames.reduce((n, s) => n + map![s]!.length, 0)
      if (total === 0) {
        const details: DbSchemaDetails = {
          connection: target.name,
          dialect: target.dialect,
          objectCount: 0,
        }
        return {
          content: `"${target.name}" [${target.dialect}] has no tables/objects yet.`,
          details,
        }
      }
      let shown = 0
      const blocks = schemaNames.map((s) => {
        const objs = map![s]!
        const take = objs.slice(0, Math.max(0, MAX_OBJECTS - shown))
        shown += take.length
        const list = take.map((o) => `  ${o.name}${o.type === 'view' ? ' (view)' : ''}`).join('\n')
        return `${s} (${objs.length}):\n${list}`
      })
      const more =
        total > shown
          ? `\n… ${total - shown} more objects (showing ${shown}). Ask for a specific table.`
          : ''
      const details: DbSchemaDetails = {
        connection: target.name,
        dialect: target.dialect,
        objectCount: total,
      }
      return {
        content: `"${target.name}" [${target.dialect}] — ${total} object(s) across ${schemaNames.length} schema(s):\n${blocks.join('\n')}${more}\n\nPass a table to see its columns.`,
        details,
      }
    },
  })
}
