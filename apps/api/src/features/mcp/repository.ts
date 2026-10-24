import type { Kysely } from 'kysely'

import type { AppDatabase, McpTransport } from '../../db'
import { announceSourceRemoved } from '../capabilities/removal-notice'

/**
 * MCP servers over the shared `capability_source` table.
 *
 * Two of this record's fields — `transport` and `description` — are STORED inside
 * `config` rather than as columns of their own. Neither is ever queried on (they are read
 * after load, always), and columns for them would have sat null on the three other kinds
 * the table serves. The record keeps them at the top level because that is the shape the
 * wire and the connect path expect; the mapping lives here and nowhere else.
 *
 * `id` remains the address: unlike a plugin or an agent, an MCP server is referenced by
 * id from the toggle endpoint and its own routes.
 */
export interface McpServerRecord {
  id: string
  userId: string
  /** '' = sessions without a project; otherwise the exact project id. */
  projectId: string
  name: string
  description: string
  transport: McpTransport
  /** Transport-specific connection details (stdio: command/env; http: url/headers). */
  config: Record<string, unknown>
  /**
   * The config's `${…}` tokens were already resolved when the record was built (a plugin's
   * server, `plugins/mcp.ts`), so connecting must not expand them again: a resolved value such
   * as an option set to `${GITHUB_TOKEN}` would otherwise read the host environment.
   */
  configExpanded?: boolean
  /**
   * The `env` of the Claude Code settings for the folder the run connects from
   * (`claude-code-servers.ts`): the limits Claude Code reads from its environment —
   * `MCP_TIMEOUT`, `MCP_TOOL_TIMEOUT`, `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`, `MAX_MCP_OUTPUT_TOKENS` —
   * are read from it over the API's own. Never stored.
   */
  settingsEnv?: Readonly<Record<string, string>>
  createdAt: string
  updatedAt: string
}

export interface McpServerWriteInput {
  id: string
  userId: string
  projectId: string
  name: string
  description: string
  transport: McpTransport
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

interface StoredRow {
  id: string
  user_id: string
  project_id: string
  name: string
  config: string
  created_at: string
  updated_at: string
}

/** What goes into the stored blob: the connection details plus the two folded fields. */
const encode = (input: {
  description: string
  transport: McpTransport
  config: Record<string, unknown>
}): string =>
  JSON.stringify({ ...input.config, transport: input.transport, description: input.description })

function decode(raw: string): {
  description: string
  transport: McpTransport
  config: Record<string, unknown>
} {
  let parsed: Record<string, unknown> = {}
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object') parsed = value as Record<string, unknown>
  } catch {
    // A hand-edited row must not take the whole list down with it.
  }
  const { transport, description, ...config } = parsed
  return {
    // `stdio` is the only default that cannot misfire: a row without a usable transport
    // has no url either, so the connect attempt fails loudly instead of dialling out.
    transport: (typeof transport === 'string' ? transport : 'stdio') as McpTransport,
    description: typeof description === 'string' ? description : '',
    config,
  }
}

const mapRow = (row: StoredRow): McpServerRecord => ({
  id: row.id,
  userId: row.user_id,
  projectId: row.project_id,
  name: row.name,
  ...decode(row.config),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

/** In-place edit of an existing row by id — carries the mutable fields only. */
export interface McpServerUpdateInput {
  name: string
  description: string
  transport: McpTransport
  config: Record<string, unknown>
  updatedAt: string
}

export interface McpRepository {
  /** Servers for one exact session scope. No-project servers never appear in projects. */
  listForScope(userId: string, projectId: string): Promise<McpServerRecord[]>
  getById(userId: string, id: string): Promise<McpServerRecord | null>
  /** Upsert by (user, scope, name): updates the existing row or inserts a new one. */
  upsert(input: McpServerWriteInput): Promise<McpServerRecord>
  /**
   * Update an existing row BY ID (rename-safe — the id + created_at are kept, so a
   * name change edits the row in place instead of inserting a duplicate). Returns
   * the fresh row, or null if the id is absent.
   */
  updateById(
    userId: string,
    id: string,
    input: McpServerUpdateInput,
  ): Promise<McpServerRecord | null>
  delete(userId: string, id: string): Promise<void>
}

export function createMcpRepository(db: Kysely<AppDatabase>): McpRepository {
  const servers = () => db.selectFrom('capability_source').selectAll().where('kind', '=', 'mcp')

  return {
    async listForScope(userId, projectId) {
      const rows = await servers()
        .where('user_id', '=', userId)
        .where('project_id', '=', projectId)
        .orderBy('name', 'asc')
        .execute()
      return rows.map(mapRow)
    },

    async getById(userId, id) {
      const row = await servers()
        .where('user_id', '=', userId)
        .where('id', '=', id)
        .executeTakeFirst()
      return row ? mapRow(row) : null
    },

    async upsert(input) {
      const config = encode(input)
      // Atomic on the (user, kind, project, name) unique key — no check-then-write
      // window. On conflict the existing id/created_at are kept.
      await db
        .insertInto('capability_source')
        .values({
          id: input.id,
          user_id: input.userId,
          kind: 'mcp',
          project_id: input.projectId,
          name: input.name,
          config,
          created_at: input.createdAt,
          updated_at: input.updatedAt,
        })
        .onConflict((oc) =>
          oc.columns(['user_id', 'kind', 'project_id', 'name']).doUpdateSet({
            config,
            updated_at: input.updatedAt,
          }),
        )
        .execute()
      const row = await servers()
        .where('user_id', '=', input.userId)
        .where('project_id', '=', input.projectId)
        .where('name', '=', input.name)
        .executeTakeFirstOrThrow()
      return mapRow(row)
    },

    async updateById(userId, id, input) {
      await db
        .updateTable('capability_source')
        .set({ name: input.name, config: encode(input), updated_at: input.updatedAt })
        .where('kind', '=', 'mcp')
        .where('user_id', '=', userId)
        .where('id', '=', id)
        .execute()
      const row = await servers()
        .where('user_id', '=', userId)
        .where('id', '=', id)
        .executeTakeFirst()
      return row ? mapRow(row) : null
    },

    async delete(userId, id) {
      const remove = async (trx: Kysely<AppDatabase>) => {
        const row = await trx
          .deleteFrom('capability_source')
          .where('kind', '=', 'mcp')
          .where('user_id', '=', userId)
          .where('id', '=', id)
          .returning(['id', 'name', 'project_id'])
          .executeTakeFirst()
        if (row) await announceSourceRemoved(trx, 'mcp', row)
      }
      await (db.isTransaction ? remove(db) : db.transaction().execute(remove))
    },
  }
}
