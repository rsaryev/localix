import { defineAgentTool } from '@localixai/agent/agents'
import { z } from 'zod'
import { resolveAgentDatabaseConnection, type AgentDatabaseConnection } from './agent-connection'
import { renderDbRows } from './db-query'

export interface DbBrowsePort {
  listConnections(userId: string): Promise<AgentDatabaseConnection[]>
  browse(
    userId: string,
    connectionId: string,
    request: {
      table: string
      schema?: string
      limit: number
      offset: number
      sort?: { column: string; direction: 'asc' | 'desc' }
    },
    /** The run's abort: a stopped turn must stop its read, not leave it holding the connection. */
    signal?: AbortSignal,
  ): Promise<{
    columns: Array<{ name: string }>
    rows: unknown[][]
    durationMs: number
  } | null>
}

export interface DbBrowseToolOptions {
  userId: string
  port: DbBrowsePort
}

const inputSchema = z.object({
  table: z
    .string()
    .min(1)
    .describe('Table, collection, index, or key to sample through the structured read-only port.'),
  schema: z.string().optional().describe('Optional schema or namespace that qualifies the object.'),
  connection_id: z
    .string()
    .optional()
    .describe('Which connection to browse. Omit when exactly one database is connected.'),
  limit: z.number().int().min(1).max(50).default(20).describe('Rows to return (1–50).'),
  offset: z.number().int().min(0).max(1_000_000).default(0).describe('Zero-based row offset.'),
  sort_column: z.string().min(1).optional().describe('Optional column/field to sort by.'),
  sort_direction: z.enum(['asc', 'desc']).default('asc').describe('Sort direction.'),
})

/** Safely sample an object without asking the model to generate dialect-specific SELECT syntax. */
export function createDbBrowseTool(options: DbBrowseToolOptions) {
  return defineAgentTool({
    name: 'db_browse',
    activeVerb: 'Browsing database data',
    description:
      'Read a small, bounded page from a table, collection, index, or key in Database Workspace. ' +
      'This is the safest way to sample data after db_schema: it uses the structured driver port, ' +
      'quotes SQL identifiers server-side, never generates a write, and works across SQL, Redis, ' +
      'MongoDB, and Elasticsearch. Use db_query only when filtering, aggregation, joins, or a native ' +
      'engine command is actually required.',
    inputSchema,
    executionMode: 'parallel',
    // Silence would classify a bounded sample as `external` (an undeclared tool is unknown).
    mutates: false,
    async execute(_toolCallId, input, signal) {
      const resolution = resolveAgentDatabaseConnection(
        await options.port.listConnections(options.userId),
        input.connection_id,
      )
      if (!resolution.ok) return { content: resolution.error, isError: true }
      const target = resolution.target
      const limit = input.limit ?? 20
      const offset = input.offset ?? 0
      try {
        const result = await options.port.browse(
          options.userId,
          target.id,
          {
            table: input.table,
            schema: input.schema,
            limit,
            offset,
            ...(input.sort_column
              ? {
                  sort: {
                    column: input.sort_column,
                    direction: input.sort_direction ?? 'asc',
                  },
                }
              : {}),
          },
          signal,
        )
        if (!result) return { content: 'Connection not found or disconnected.', isError: true }
        const qualified = input.schema ? `${input.schema}.${input.table}` : input.table
        const table = renderDbRows(result.columns, result.rows)
        return {
          content:
            `${result.rows.length} row(s) from ${qualified} on "${target.name}" ` +
            `[${target.dialect}] at offset ${offset} in ${Math.round(result.durationMs)} ms` +
            (table ? `:\n\n${table}` : '.'),
          details: {
            connection: target.name,
            dialect: target.dialect,
            table: qualified,
            offset,
            rowCount: result.rows.length,
            columns: result.columns.map((column) => column.name),
            durationMs: Math.round(result.durationMs),
          },
        }
      } catch (error) {
        return {
          content: `Could not browse "${input.table}": ${
            error instanceof Error ? error.message : String(error)
          }`,
          isError: true,
        }
      }
    },
  })
}
