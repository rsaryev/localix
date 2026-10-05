/**
 * `database_client` — the plugin's ONE agent tool. Wiring only: validate → pick the verb →
 * delegate → announce what a successful write changed (`shared/database-changes.ts`).
 * The contract and its read/write classifier live in `database-tool-schema.ts`; each verb's body
 * stays its own module, the way `api_client` fronts requests and environments.
 */
import { defineAgentTool, type AgentToolExecutionContext } from '@localixai/agent/agents'
import { DATABASE_CHANGES_CHANNEL, DATABASE_PLUGIN } from '../shared/database-changes'
import { createDbBrowseTool, type DbBrowsePort } from './db-browse'
import { runConnectionAction, type DbConnectionsPort } from './db-connections'
import { createDbQueryTool, type DbQueryPort } from './db-query'
import { createDbSchemaTool, type DbSchemaPort } from './db-schema'
import {
  changeOfCall,
  classifyDatabaseCallClass,
  databaseCallPaths,
  databaseCallProblem,
  databaseToolSchema,
  type DatabaseToolInput,
} from './database-tool-schema'

export const DATABASE_TOOL_DESCRIPTION =
  'One tool for the databases the user works with in the Database workbench — SQL engines and Redis, MongoDB, Elasticsearch. ' +
  'Start with action="connections" to see what is saved and connected. ' +
  'To learn structure: action="schema" (connection tables), then with table for one table’s columns and keys. ' +
  'To look at data: action="browse" samples a bounded page safely; action="query" runs the engine’s own language (capped at 50 rows) — ' +
  'select the columns you need and add a LIMIT; writes and DDL run against the user’s real database. ' +
  'To add a database the user asked for: action="connect" with a url (or file for SQLite, or host fields); ' +
  'check first with action="test" when unsure; prefer ${secret:KEY} over a literal password; set readonly for production data. ' +
  'reconnect / disconnect / remove manage a saved connection by connection_id. Never returns stored credentials.'

export interface DatabaseToolPorts {
  schema: DbSchemaPort
  browse: DbBrowsePort
  query: DbQueryPort
  connections: DbConnectionsPort
}

export function createDatabaseTool(options: { userId: string; ports: DatabaseToolPorts }) {
  const { userId, ports } = options
  // The bodies, built once; their own schemas are no longer model-facing — this tool's is.
  const schemaTool = createDbSchemaTool({ userId, port: ports.schema })
  const browseTool = createDbBrowseTool({ userId, port: ports.browse })
  const queryTool = createDbQueryTool({ userId, port: ports.query })

  const run = (toolCallId: string, input: DatabaseToolInput, signal?: AbortSignal) => {
    switch (input.action) {
      case 'schema':
        return schemaTool.execute(toolCallId, input, signal)
      case 'browse':
        return browseTool.execute(
          toolCallId,
          {
            table: input.table!,
            schema: input.schema,
            connection_id: input.connection_id,
            limit: input.limit ?? 20,
            offset: input.offset ?? 0,
            sort_column: input.sort_column,
            sort_direction: input.sort_direction ?? 'asc',
          },
          signal,
        )
      case 'query':
        return queryTool.execute(
          toolCallId,
          { query: input.query!, connection_id: input.connection_id },
          signal,
        )
      case 'connections':
      case 'connect':
      case 'test':
      case 'reconnect':
      case 'disconnect':
      case 'remove':
        return runConnectionAction(ports.connections, userId, input)
    }
  }

  return defineAgentTool({
    // Compound, like `api_client`: core is checked for plugin tool names as bare words
    // (`plugin-identity-guard`), and a bare `database` is a word core rightly uses everywhere.
    name: 'database_client',
    label: 'Database',
    activeVerb: 'Working with the database',
    description: DATABASE_TOOL_DESCRIPTION,
    inputSchema: databaseToolSchema,
    // One tool cannot be two execution modes: a query or a connect racing another write would
    // decide the outcome by arrival order, so the stricter of the bodies' modes wins.
    executionMode: 'sequential',
    mutates: true,
    // A remote database and the saved-connection list are no filesystem path; a SQLite
    // file opened by `connect`/`test` is one (it is created when missing) — see the helper.
    permissionPaths: databaseCallPaths,
    classify: classifyDatabaseCallClass,
    async execute(
      toolCallId,
      input: DatabaseToolInput,
      signal?: AbortSignal,
      _onUpdate?: unknown,
      executionContext?: AgentToolExecutionContext,
    ) {
      const problem = databaseCallProblem(input)
      if (problem) return { content: problem, isError: true }
      const result = await run(toolCallId, input, signal)
      // The workbench learns of its own writes from its own calls, never of these: say what moved.
      const change = result.isError ? null : changeOfCall(input)
      if (change) {
        executionContext?.session?.emitCommand?.(DATABASE_PLUGIN, DATABASE_CHANGES_CHANNEL, change)
      }
      return result
    },
  })
}
