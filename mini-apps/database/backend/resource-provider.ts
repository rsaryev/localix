/**
 * DATABASE resource provider — the FIRST `ResourceRefProvider` (agent-core
 * resource-refs), owning the `localix://resource/db` provider namespace. It turns the existing
 * registry + schema introspection into a referenceable tree the composer drills
 * (connection → schema → table → column) and resolves a node to model-facing text
 * (DDL + approx row count for a table; type/nullability/FK for a column).
 *
 * URI grammar (positional; the `<database>` segment is reserved for a future
 * multi-database drill and always emitted as `_` in v1 — §6 of the design):
 *   localix://resource/db/<connId>                          → a connection (root)
 *   localix://resource/db/<connId>/_/<schema>               → a schema
 *   localix://resource/db/<connId>/_/<schema>/<table>       → a table/view
 *   localix://resource/db/<connId>/_/<schema>/<table>/<col> → a column
 *
 * ZERO new introspection: it reuses `DatabaseService.list/schemas/tableSchema`
 * (accepted here as a narrow structural port so it's trivially testable — a table's
 * row count is the engine's cheap `approxRows` stat, never a `COUNT(*)`). It works
 * from `DbConnectionInfo` + introspection metadata only — it NEVER touches the
 * connection URL/credentials, so an expansion can never leak a secret.
 */
import type { DbConnectionInfo } from './contracts'
import {
  buildCommentStatements,
  buildIndexStatements,
  buildPostgresAccessStatements,
  buildPostgresExtendedStatisticsStatements,
  buildPostgresSequenceStateStatements,
  buildPostgresTableStateStatements,
  buildRuleStatements,
  buildTableDDL,
  buildTriggerStatements,
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
import type { DbColumn, DbSchemas, DbTableSchema } from './drivers/port'
import type {
  ResourceExpansion,
  ResourceNode,
  ResourceRefProvider,
} from '@localixai/mini-app-sdk/backend'
import {
  buildResourceUri,
  decodeResourceSegment,
  encodeResourceSegment,
  linkAction,
  providerSegments,
} from '@localixai/mini-app-sdk/backend'
import { DATABASE_RESOURCE_PROVIDER } from './resource-provider-id'
import { renderRecentQueriesForContext } from './recent-query-context'
import { getDatabaseDriverManifest } from '../shared/driver-catalog'
import { ownRecordValue } from '../shared/safe-record'

/** The URI provider this mini app owns — derived from the shared vocabulary, never re-spelled.
 *  (Core still dispatches ARBITRARY provider strings; the vocabulary is shared, not closed.) */
const PROVIDER = DATABASE_RESOURCE_PROVIDER

/** Narrow structural port over `DatabaseService` — the only methods this needs. */
export interface ResourceDbService {
  list(userId: string): Promise<DbConnectionInfo[]>
  schemas(userId: string, id: string): Promise<{ schemas: DbSchemas } | null>
  tableSchema(
    userId: string,
    id: string,
    schema: string | undefined,
    table: string,
  ): Promise<{ table: DbTableSchema } | null>
  recentQueries?(userId: string, id: string, limit?: number): Promise<string[]>
}

/** Reserved single-database placeholder segment (§6). */
const DB_SEG = '_'
const SCHEMA_INVENTORY_MAX_OBJECTS = 80
const SCHEMA_INVENTORY_MAX_CHARS = 3_500
/** Stay below the Context Fabric provider quota so a very wide table is compacted
 * into useful schema evidence instead of being rejected as one oversized item. */
const TABLE_CONTEXT_MAX_BYTES = 4_000
const TABLE_CONTEXT_MAX_LINE_BYTES = 720

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function clipUtf8(value: string, maxBytes: number, fromEnd = false): string {
  if (maxBytes <= 0) return ''
  if (utf8Bytes(value) <= maxBytes) return value
  const points = Array.from(value)
  const kept: string[] = []
  let used = 0
  if (fromEnd) {
    for (let index = points.length - 1; index >= 0; index--) {
      const point = points[index]!
      const bytes = utf8Bytes(point)
      if (used + bytes > maxBytes) break
      kept.push(point)
      used += bytes
    }
    return kept.reverse().join('')
  }
  for (const point of points) {
    const bytes = utf8Bytes(point)
    if (used + bytes > maxBytes) break
    kept.push(point)
    used += bytes
  }
  return kept.join('')
}

function boundedSchemaLine(line: string): string {
  const clean = line.replace(/[\r\n\t]+/g, ' ')
  if (utf8Bytes(clean) <= TABLE_CONTEXT_MAX_LINE_BYTES) return clean
  const marker = '…'
  const tailBytes = 180
  return `${clipUtf8(clean, TABLE_CONTEXT_MAX_LINE_BYTES - tailBytes - utf8Bytes(marker))}${marker}${clipUtf8(clean, tailBytes, true)}`
}

/** Keep the identity/leading columns and the FK/index tail, with an explicit gap. */
function boundSchemaLines(lines: string[], maxBytes: number): string {
  const bounded = lines.map(boundedSchemaLine)
  const full = bounded.join('\n')
  if (utf8Bytes(full) <= maxBytes) return full
  const marker = '… schema entries omitted …'
  const head: string[] = []
  const tail: string[] = []
  let used = utf8Bytes(marker) + 2
  let left = 0
  let right = bounded.length - 1
  let phase = 0
  while (left <= right) {
    // Balance leading column order with the structural tail. The tail carries constraints,
    // partitioning, indexes, triggers, and the final columns (which may be generated), so it
    // needs equal budget rather than becoming incidental when another metadata kind is added.
    const takeTail = phase % 2 === 1
    const line = takeTail ? bounded[right] : bounded[left]
    if (line === undefined) break
    const cost = utf8Bytes(line) + 1
    if (used + cost <= maxBytes) {
      if (takeTail) tail.push(line)
      else head.push(line)
      used += cost
    }
    if (takeTail) right--
    else left++
    phase++
  }
  return [...head, marker, ...tail.reverse()].join('\n')
}

function renderTableContext(
  table: DbTableSchema,
  dialect: DbConnectionInfo['dialect'],
  schema: string,
  connectionName: string,
): string {
  const count = table.approxRows ?? null
  const identity = `-- ${dialect} · ${schema}.${table.name}${count != null ? ` · ~${count} rows` : ''}`
  const foreignKeys = table.foreignKeys.map((foreignKey) => `-- ${describeForeignKey(foreignKey)}`)
  const checks = (table.checkConstraints ?? []).map(
    (check) => `-- ${describeCheckConstraint(check)}`,
  )
  const keys = (table.keyConstraints ?? []).map((key) => `-- ${describeKeyConstraint(key)}`)
  const exclusions = (table.exclusionConstraints ?? []).map(
    (exclusion) => `-- ${describeExclusionConstraint(exclusion)}`,
  )
  const indexes = buildIndexStatements(table, dialect)
  const comments = buildCommentStatements(table, dialect)
  const postgresState = buildPostgresTableStateStatements(table, dialect)
  const rules = buildRuleStatements(table)
  const triggers = buildTriggerStatements(table)
  const access = buildPostgresAccessStatements(table, dialect)
  const extendedStatistics = buildPostgresExtendedStatisticsStatements(table, dialect)
  const sequences = buildPostgresSequenceStateStatements(table, dialect)
  const complete = [
    identity,
    ...keys,
    ...foreignKeys,
    ...checks,
    ...exclusions,
    buildTableDDL(table, dialect),
    ...comments,
    ...indexes,
    ...postgresState,
    ...rules,
    ...triggers,
    ...access,
    ...extendedStatistics,
    ...sequences,
  ].join('\n')
  if (utf8Bytes(complete) <= TABLE_CONTEXT_MAX_BYTES) return complete

  // A giant verbatim CREATE would exceed the provider quota and be dropped as a
  // whole. Fall back to a bounded structural view: identity + ordered columns,
  // with PK/FK/index evidence repeated at the tail where balanced clipping keeps it.
  const primaryKey = table.primaryKey.length
    ? `Primary key: (${table.primaryKey.join(', ')})`
    : 'Primary key: (none declared)'
  const columns = table.columns.map((column) => {
    const flags = [column.pk ? 'PK' : '', column.nullable ? 'NULL' : 'NOT NULL'].filter(Boolean)
    const generation = describeColumnGeneration(column)
    const foreignOptions = describePostgresForeignColumn(column)
    const postgresProperties = describePostgresColumnProperties(column)
    const defaultValue =
      column.defaultValue == null
        ? ''
        : ` · DEFAULT ${boundedSchemaLine(String(column.defaultValue))}`
    const comment = column.comment ? ` · COMMENT ${boundedSchemaLine(column.comment)}` : ''
    return `- ${column.name}: ${column.dataType} · ${flags.join(', ')}${generation ? ` · ${boundedSchemaLine(generation)}` : ''}${foreignOptions ? ` · ${boundedSchemaLine(foreignOptions)}` : ''}${postgresProperties ? ` · ${boundedSchemaLine(postgresProperties)}` : ''}${defaultValue}${comment}`
  })
  const compactIndexes = table.indexes.flatMap((index) =>
    index.primary
      ? []
      : [
          `${index.name}${index.unique ? ' UNIQUE' : ''}${index.constraint ? ' CONSTRAINT' : ''} (${index.columns.join(', ')})${index.includeColumns?.length ? ` INCLUDE (${index.includeColumns.join(', ')})` : ''}${index.predicate ? ` WHERE ${boundedSchemaLine(index.predicate)}` : ''}`,
        ],
  )
  const compactTriggers = (table.triggers ?? []).map((trigger) => {
    if (trigger.definitionUnavailable) return `${trigger.name} (definition unavailable)`
    const before = (trigger.preCreateScripts ?? [])
      .map((script) => boundedSchemaLine(script))
      .join('; ')
    const after = (trigger.postCreateScripts ?? [])
      .map((script) => boundedSchemaLine(script))
      .join('; ')
    return `${trigger.name} (native definition${before ? `; before: ${before}` : ''}${after ? `; after: ${after}` : ''})`
  })
  const compactRules = (table.rules ?? []).map(describeRule)
  const postgresAccess = describePostgresAccess(table)
  const compactExtendedStatistics = (table.postgresExtendedStatistics ?? []).map(
    describePostgresExtendedStatistic,
  )
  const compact = [
    identity,
    `Database: ${connectionName}. Wide schema compacted from ${table.columns.length} columns.`,
    ...(table.comment ? [`Comment: ${boundedSchemaLine(table.comment)}`] : []),
    primaryKey,
    `Columns (${table.columns.length}, declared order):`,
    ...columns,
    ...(keys.length ? ['Key constraints:', ...keys.map((line) => line.replace(/^-- /, '- '))] : []),
    ...(foreignKeys.length
      ? ['Foreign keys:', ...foreignKeys.map((line) => line.replace(/^-- /, '- '))]
      : []),
    ...(checks.length
      ? ['Check constraints:', ...checks.map((line) => line.replace(/^-- /, '- '))]
      : []),
    ...(exclusions.length
      ? ['Exclusion constraints:', ...exclusions.map((line) => line.replace(/^-- /, '- '))]
      : []),
    ...(dialect === 'postgres' && table.postgresPartition
      ? [
          `Partitioning: PARTITION OF ${table.postgresPartition.parentSchema}.${table.postgresPartition.parentTable} ${table.postgresPartition.bound}`,
        ]
      : []),
    ...(dialect === 'postgres' && table.postgresPartitionBy
      ? [
          `${table.postgresPartition ? 'Subpartitioning' : 'Partitioning'}: PARTITION BY ${table.postgresPartitionBy}`,
        ]
      : []),
    ...(dialect === 'postgres' && table.postgresInheritance
      ? [
          `Inheritance: INHERITS (${table.postgresInheritance.parents
            .map((parent) => `${parent.schema}.${parent.table}`)
            .join(', ')})`,
        ]
      : []),
    ...(dialect === 'postgres' && table.postgresOfType
      ? [`Typed table: OF ${table.postgresOfType.schema}.${table.postgresOfType.name}`]
      : []),
    ...(dialect === 'postgres' && table.postgresForeign
      ? [`Foreign table: ${describePostgresForeign(table)}`]
      : []),
    ...(dialect === 'postgres' && table.postgresRelation
      ? [`PostgreSQL relation: ${describePostgresRelation(table)}`]
      : []),
    ...(dialect === 'postgres' && table.postgresRowSecurity
      ? [
          `Row security: ${table.postgresRowSecurity.enabled ? 'ENABLED' : 'DISABLED'}${table.postgresRowSecurity.forced ? ' · FORCED' : ''}`,
          ...table.postgresRowSecurity.policies.map(
            (policy) => `- ${boundedSchemaLine(describePostgresPolicy(policy))}`,
          ),
        ]
      : []),
    ...(dialect === 'postgres' && table.postgresReplicaIdentity
      ? [
          `Replica identity: ${
            table.postgresReplicaIdentity.mode === 'INDEX'
              ? `USING INDEX ${table.postgresReplicaIdentity.index}`
              : table.postgresReplicaIdentity.mode
          }`,
        ]
      : []),
    ...(dialect === 'postgres' && table.postgresClusteredIndex
      ? [`Clustered index: ${table.postgresClusteredIndex}`]
      : []),
    ...(postgresAccess ? [`PostgreSQL access: ${boundedSchemaLine(postgresAccess)}`] : []),
    ...(compactExtendedStatistics.length
      ? [
          'Extended statistics:',
          ...compactExtendedStatistics.map((statistic) => `- ${boundedSchemaLine(statistic)}`),
        ]
      : []),
    ...(compactIndexes.length ? ['Indexes:', ...compactIndexes.map((line) => `- ${line}`)] : []),
    ...(compactRules.length ? ['Rules:', ...compactRules.map((rule) => `- ${rule}`)] : []),
    ...(compactTriggers.length
      ? ['Triggers:', ...compactTriggers.map((trigger) => `- ${trigger}`)]
      : []),
  ]
  return boundSchemaLines(compact, TABLE_CONTEXT_MAX_BYTES)
}

function renderSchemaInventory(schemas: DbSchemas): string[] {
  const lines: string[] = []
  let objectsLeft = SCHEMA_INVENTORY_MAX_OBJECTS
  let charsLeft = SCHEMA_INVENTORY_MAX_CHARS
  for (const [schema, items] of Object.entries(schemas)) {
    if (charsLeft <= 0 || objectsLeft <= 0) break
    const prefix = `- ${schema}: `
    const visible: string[] = []
    let lineLength = prefix.length
    for (const item of items) {
      if (objectsLeft <= 0) break
      const token = `${item.name} (${item.type})`
      const separatorLength = visible.length > 0 ? 2 : 0
      if (lineLength + separatorLength + token.length > charsLeft) break
      visible.push(token)
      lineLength += separatorLength + token.length
      objectsLeft--
    }
    const remaining = items.length - visible.length
    const suffix = remaining > 0 ? `, … +${remaining}` : ''
    const line = `${prefix}${visible.join(', ') || '(empty)'}${suffix}`.slice(0, charsLeft)
    lines.push(line)
    charsLeft -= line.length
  }
  const total = Object.values(schemas).reduce((sum, items) => sum + items.length, 0)
  const shown = SCHEMA_INVENTORY_MAX_OBJECTS - objectsLeft
  if (shown < total && charsLeft > 20) lines.push(`- … ${total - shown} more objects`)
  return lines
}

// Schema/table/column names are percent-encoded per segment (a table named
// `my table` or `orders(archive)` must survive the `@resource:\S+` token grammar
// and the positional split); connection ids are host-minted UUIDs, left as-is.
const schemaUri = (connId: string, schema: string) =>
  buildResourceUri(PROVIDER, [connId, DB_SEG, schema])
const tableUri = (connId: string, schema: string, table: string) =>
  `${schemaUri(connId, schema)}/${encodeResourceSegment(table)}`

function describeColumn(col: DbColumn, table: DbTableSchema): string {
  const parts = [`${col.name} ${col.dataType}`, col.nullable ? 'NULL' : 'NOT NULL']
  const notNull = describePostgresNotNull(col)
  if (notNull) parts.push(notNull)
  if (col.pk) parts.push('PRIMARY KEY')
  const generation = describeColumnGeneration(col)
  if (generation) parts.push(generation)
  const postgresProperties = describePostgresColumnProperties(col)
  if (postgresProperties) parts.push(postgresProperties)
  if (col.defaultValue != null) parts.push(`DEFAULT ${col.defaultValue}`)
  if (col.comment) parts.push(`COMMENT ${boundedSchemaLine(col.comment)}`)
  const fk = table.foreignKeys.find((f) => f.columns.includes(col.name))
  if (fk) {
    const i = fk.columns.indexOf(col.name)
    parts.push(`→ ${fk.refTable}(${fk.refColumns[i] ?? fk.refColumns[0]})`)
  }
  return parts.join(' · ')
}

export function createDatabaseResourceProvider(service: ResourceDbService): ResourceRefProvider {
  /** Resolve a connection's DbConnectionInfo (name/dialect/flags) by id. */
  async function connInfo(userId: string, connId: string): Promise<DbConnectionInfo | undefined> {
    return (await service.list(userId)).find((c) => c.id === connId)
  }

  async function schemaNodes(userId: string, connId: string): Promise<ResourceNode[]> {
    const res = await service.schemas(userId, connId)
    if (!res) return [] // not connected
    const keys = Object.keys(res.schemas)
    // Single-schema engines (sqlite): skip the pointless one-item schema level and
    // list its tables directly. Multi-schema engines expose the schema level.
    if (keys.length === 1) return tableNodes(connId, keys[0], res.schemas)
    return keys.map((schema) => ({
      uri: schemaUri(connId, schema),
      label: schema,
      detail: `${ownRecordValue(res.schemas, schema)?.length ?? 0} objects`,
      hasChildren: true,
      icon: 'schema',
      actions: linkAction('Link this schema'),
    }))
  }

  function tableNodes(connId: string, schema: string, schemas: DbSchemas): ResourceNode[] {
    return (ownRecordValue(schemas, schema) ?? []).map((item) => ({
      uri: tableUri(connId, schema, item.name),
      label: item.name,
      detail: item.type === 'view' ? 'view' : 'table',
      hasChildren: true,
      icon: item.type === 'view' ? 'view' : 'table',
      actions: linkAction(item.type === 'view' ? 'Link this view' : 'Link this table'),
    }))
  }

  async function columnNodes(
    userId: string,
    connId: string,
    schema: string,
    table: string,
  ): Promise<ResourceNode[]> {
    const res = await service.tableSchema(userId, connId, schema, table)
    if (!res) return []
    return res.table.columns.map((col) => ({
      uri: `${tableUri(connId, schema, table)}/${encodeResourceSegment(col.name)}`,
      label: col.name,
      detail: col.dataType + (col.pk ? ' · PK' : '') + (col.nullable ? '' : ' · NOT NULL'),
      hasChildren: false,
      icon: 'column',
    }))
  }

  return {
    provider: PROVIDER,
    title: 'Databases',

    async listChildren(userId, parentUri) {
      if (parentUri === null) {
        const conns = await service.list(userId)
        return conns.map((c) => ({
          uri: buildResourceUri(PROVIDER, [c.id]),
          label: c.name,
          detail: c.connected ? c.dialect : `${c.dialect} · disconnected`,
          hasChildren: c.connected,
          icon: 'connection',
          actions: linkAction('Link this connection'),
        }))
      }
      const segments = providerSegments(PROVIDER, parentUri)
      if (!segments) return []
      // Decode per segment (guarded — a legacy/drag-minted unencoded name passes through).
      const [connId, , schema, table] = segments.map(decodeResourceSegment)
      if (!connId) return []
      if (segments.length === 1) return schemaNodes(userId, connId)
      if (segments.length === 3 && schema) {
        const res = await service.schemas(userId, connId)
        return res ? tableNodes(connId, schema, res.schemas) : []
      }
      if (segments.length === 4 && schema && table)
        return columnNodes(userId, connId, schema, table)
      return []
    },

    async expand(userId, uri): Promise<ResourceExpansion> {
      const segments = providerSegments(PROVIDER, uri)
      if (!segments) return { ok: false, error: 'not a db resource' }
      const [connId, , schema, table, column] = segments.map(decodeResourceSegment)
      if (!connId) return { ok: false, error: 'missing connection id' }
      const conn = await connInfo(userId, connId)
      if (!conn) return { ok: false, error: 'connection not found' }

      // Connection node — dialect, flags, schema list (no host/credentials).
      if (segments.length === 1) {
        const manifest = getDatabaseDriverManifest(conn.dialect)
        const [res, recentQueries] = await Promise.all([
          service.schemas(userId, connId),
          service.recentQueries?.(userId, connId, 6).catch(() => []) ?? Promise.resolve([]),
        ])
        const lines = [
          `Database connection "${conn.name}" (${conn.dialect} · ${manifest.label}, ${manifest.kind})${conn.connected ? '' : ' — not connected'}.`,
          `Query language: ${manifest.queryLanguage}. Example: ${manifest.queryExample}.`,
          `Capabilities: ${
            [
              manifest.capabilities.dataBrowser && 'data browsing',
              manifest.capabilities.relationships && 'relationships',
              manifest.capabilities.explain && 'query plans',
              manifest.capabilities.manualTransactions && 'manual transactions',
              manifest.capabilities.queryCancel && 'query cancellation',
            ]
              .filter(Boolean)
              .join(', ') || 'basic querying'
          }.`,
        ]
        if (conn.flags)
          lines.push(
            `Default schema: ${conn.flags.defaultSchema}. Multiple schemas: ${conn.flags.supportsMultipleSchemas ? 'yes' : 'no'}.`,
          )
        if (res) {
          const parts = renderSchemaInventory(res.schemas)
          lines.push('', 'Schemas:', ...parts)
        } else {
          lines.push('', '(connect to browse schemas)')
        }
        const recent = renderRecentQueriesForContext(recentQueries)
        if (recent)
          lines.push('', 'Recent successful query shapes (literal values removed):', recent)
        return { ok: true, content: lines.join('\n') }
      }

      if (!conn.connected) return { ok: false, error: 'connection is not established' }

      // Schema node — its tables/views.
      if (segments.length === 3 && schema) {
        const res = await service.schemas(userId, connId)
        const items = res ? ownRecordValue(res.schemas, schema) : undefined
        if (!items) return { ok: false, error: 'schema not found' }
        const body = items.map((i) => `- ${i.name} (${i.type})`).join('\n')
        return {
          ok: true,
          content: `Schema "${schema}" in "${conn.name}" — ${items.length} objects:\n${body}`,
        }
      }

      // Table/view node — DDL + indexes + triggers + approx row count + FK summary. The count comes
      // from the engine's CHEAP stats (`tableSchema().approxRows` — pg reltuples
      // etc., the workbench convention), NEVER a `COUNT(*)` that could burn
      // seconds on a big table at every link/re-send. Unknown → omitted.
      if (segments.length === 4 && schema && table) {
        const res = await service.tableSchema(userId, connId, schema, table)
        if (!res) return { ok: false, error: 'table not found' }
        return {
          ok: true,
          language: 'sql',
          content: renderTableContext(res.table, conn.dialect, schema, conn.name),
        }
      }

      // Column node — type, nullability, PK/FK, default.
      if (segments.length === 5 && schema && table && column) {
        const res = await service.tableSchema(userId, connId, schema, table)
        const col = res?.table.columns.find((c) => c.name === column)
        if (!res || !col) return { ok: false, error: 'column not found' }
        return { ok: true, content: `Column ${schema}.${table}.${describeColumn(col, res.table)}` }
      }

      return { ok: false, error: 'unresolvable db uri' }
    },
  }
}
