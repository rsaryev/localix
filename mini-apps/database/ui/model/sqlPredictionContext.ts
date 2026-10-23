import type { DbSchemas } from '../dbClient'
import type { NextEditRequest } from '@localixai/kit/code-editor'
import type { MiniAppCompletionReference } from '@localixai/mini-app-sdk/ui'
import { extractSqlTableReferences } from '../../shared/sql-context'
import { offsetAt } from './sqlCompletion'
import { statementAt } from '../../shared/sql-statements'
import { dbConnectionResourceUri, dbResourceUri } from './dbResourceUri'

const MAX_TABLE_REFERENCES = 3

function resolveTable(
  schemas: DbSchemas | null,
  reference: { schema?: string; table: string },
): { schema: string; table: string } | null {
  if (!schemas) return null
  const schemaEntries = Object.entries(schemas)
  const candidates = reference.schema
    ? schemaEntries.filter(([schema]) => schema.toLowerCase() === reference.schema!.toLowerCase())
    : schemaEntries
  for (const [schema, items] of candidates) {
    const table = items.find((item) => item.name.toLowerCase() === reference.table.toLowerCase())
    if (table) return { schema, table: table.name }
  }
  return null
}

function resourceReference(
  uri: string,
  label: string,
  revision?: string,
): MiniAppCompletionReference {
  return {
    kind: 'resource',
    token: `@resource:${uri}`,
    label,
    uri,
    // Content-free invalidation token: a changed schema is a different reference to resolve.
    ...(revision ? { attributes: { revision } } : {}),
    origin: 'linked',
  }
}

/**
 * Build resource references for SQL prediction — the editor's own anchors. The connection root
 * gives dialect, object inventory and recent-query shapes; tables referenced by the focused
 * statement add exact server-resolved DDL/columns/FKs. What else is open on screen the host adds
 * itself, so nothing here reaches past the statement under the caret.
 */
export function sqlPredictionContextReferences(input: {
  connectionId: string
  connectionLabel: string
  schemas: DbSchemas | null
  request: NextEditRequest
  /** Content-free invalidation token (for example the last successful query time). */
  contextRevision?: string
}): MiniAppCompletionReference[] {
  if (!input.connectionId) return []
  const root = resourceReference(
    dbConnectionResourceUri(input.connectionId),
    input.connectionLabel,
    input.contextRevision,
  )
  const offset = offsetAt(
    input.request.content,
    Math.max(0, input.request.cursorLine - 1),
    input.request.cursorColumn,
  )
  const focused = statementAt(input.request.content, offset)?.text ?? input.request.content
  const tables = extractSqlTableReferences(focused)
    .map((reference) => resolveTable(input.schemas, reference))
    .filter((table): table is { schema: string; table: string } => table !== null)
    .slice(0, MAX_TABLE_REFERENCES)

  return [
    root,
    ...tables.map(({ schema, table }) =>
      resourceReference(dbResourceUri(input.connectionId, schema, table), `${schema}.${table}`),
    ),
  ]
}
