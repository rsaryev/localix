import { randomUUID } from 'node:crypto'

import type { Kysely } from 'kysely'

import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import type { AppDatabase } from '../../db'
import { ApiError, errorMessage } from '../../lib/errors'
import { localixWorkspaceDir } from '../../lib/env'
import { createMcpRepository, type McpRepository, type McpServerRecord } from './repository'
import { probeMcpServer } from './client-manager'
import { oauthStatusFor, toApi } from './server-view'
import { createAvailabilityWriter, readAvailability } from '../capabilities/availability'
import { normalizeMcpServersJson } from './normalize'
import { mcpOAuthStore } from './oauth/runtime'
import { importedToolRules } from './imported-tool-rules'
import {
  startMcpOAuth,
  finishMcpOAuth,
  type StartAuthResult,
  type FinishAuthResult,
} from './oauth/flow'
import type {
  ImportMcpServersResponse,
  McpServer,
  McpServerInput,
  McpServerStatus,
} from './contracts'

export interface McpServiceDeps {
  db: Kysely<AppDatabase>
  now?: () => string
  /** Resolves a project's working directory (for stdio cwd when probing). */
  resolveProjectCwd?: (userId: string, projectId: string) => Promise<string | null>
  /**
   * Fired after any mutation that changes what a scope's sessions can reach: a
   * server's existence, its config, its enable state, its per-tool filters, or its
   * OAuth credentials. Bootstrap binds it to the capability revision + the
   * `plugins.changed` poke, the same way the plugin service does —
   * an MCP change is a capability change, and a client holding a capability snapshot
   * has no other way to learn about it.
   */
  onChanged?: () => void
}

export interface McpService {
  listServers(
    userId: string,
    opts?: { projectId?: string | null },
  ): Promise<{ servers: McpServer[] }>
  createServer(userId: string, input: McpServerInput): Promise<McpServer>
  /** Edit an existing DB server BY ID (rename-safe — never duplicates the row). */
  updateServer(userId: string, id: string, input: McpServerInput): Promise<McpServer>
  /** Enable / disable one server (e.g. turning on an inert imported entry). */
  /** React to this scope's `mcp:` rules having changed. No storage of its own to update. */
  onPolicyChanged(): Promise<void>
  setServerEnabled(
    userId: string,
    id: string,
    enabled: boolean,
    /** Switch it for ONE agent's scope instead of the server's own project. */
    agentId?: string | null,
  ): Promise<McpServer>
  /** Enable / disable one advertised tool while preserving the rest of the server config. */
  deleteServer(userId: string, id: string): Promise<void>
  /** Probe a server's live connection. */
  testServer(userId: string, id: string): Promise<McpServerStatus>
  /** Bulk-import the ecosystem-standard `{ mcpServers: {…} }` shape. */
  importServers(
    userId: string,
    payload: { mcpServers: Record<string, Record<string, unknown>>; defaultEnabled?: boolean },
    projectId: string | null,
  ): Promise<ImportMcpServersResponse>
  /** Used by the runtime to gather servers visible to a session's scope. */
  listForRuntime(userId: string, projectId: string): Promise<McpServerRecord[]>
  /** Begin an interactive OAuth sign-in for a remote server (returns the browser URL). */
  startServerOAuth(userId: string, id: string): Promise<StartAuthResult>
  /** Complete the OAuth flow from the loopback callback (keyed by state, no ownership). */
  finishServerOAuth(state: string, code: string): Promise<FinishAuthResult>
  /** Forget a remote server's stored OAuth tokens (sign out). */
  logoutServerOAuth(userId: string, id: string): Promise<void>
}

export function createMcpService(deps: McpServiceDeps): McpService {
  const repo: McpRepository = createMcpRepository(deps.db)
  const now = deps.now ?? (() => new Date().toISOString())
  // The one writer of availability, shared with every other kind.
  const availabilityWriter = createAvailabilityWriter(deps.db)

  /**
   * Whether one server is available in its own scope.
   *
   * `?? true` is the whole difference between MCP and the drop-in registries: a server
   * exists only because the user added it, so silence means yes. A plugin's silence means
   * no, because a plugin can appear on disk without anyone asking for it.
   */
  const isAvailable = async (userId: string, record: McpServerRecord): Promise<boolean> => {
    const availability = await readAvailability(deps.db, { userId, agentId: DEFAULT_AGENT_ID })
    return availability.effectFor('mcp', record.name) !== 'deny'
  }

  const cwdFor = async (userId: string, projectId: string): Promise<string> => {
    if (projectId && deps.resolveProjectCwd) {
      const dir = await deps.resolveProjectCwd(userId, projectId)
      if (dir) return dir
    }
    return localixWorkspaceDir()
  }

  return {
    async listServers(userId, opts) {
      const projectId = opts?.projectId ?? null
      const records = projectId
        ? await repo.listForScope(userId, projectId)
        : (await repo.listForScope(userId, '')).filter((r) => r.projectId === '')
      const availability = await readAvailability(deps.db, { userId, agentId: DEFAULT_AGENT_ID })
      const servers = await Promise.all(
        records.map(async (r) =>
          toApi(r, availability.effectFor('mcp', r.name) !== 'deny', await oauthStatusFor(r)),
        ),
      )
      return { servers }
    },

    async createServer(userId, input) {
      const projectId = input.projectId ?? ''
      const timestamp = now()
      const record = await repo.upsert({
        id: randomUUID(),
        userId,
        projectId,
        name: input.name,
        description: input.description ?? '',
        transport: input.transport,
        config: input.config as Record<string, unknown>,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      // A server exists because the user added it, so it starts available and only an
      // explicit `enabled: false` is worth recording. Writing an `allow` for the normal
      // case would put a row in every scope that says what silence already says.
      if (input.enabled === false) {
        await availabilityWriter.set(userId, DEFAULT_AGENT_ID, 'mcp', [
          { name: input.name, enabled: false },
        ])
      }
      deps.onChanged?.()
      return toApi(record, input.enabled ?? true)
    },

    async updateServer(userId, id, input) {
      const existing = await repo.getById(userId, id)
      if (!existing) throw new ApiError(404, 'mcp_not_found', 'MCP server not found')
      try {
        const record = await repo.updateById(userId, id, {
          name: input.name,
          description: input.description ?? '',
          transport: input.transport,
          config: input.config as Record<string, unknown>,
          updatedAt: now(),
        })
        if (!record) throw new ApiError(404, 'mcp_not_found', 'MCP server not found')
        if (input.enabled !== undefined) {
          await availabilityWriter.set(userId, DEFAULT_AGENT_ID, 'mcp', [
            { name: record.name, enabled: input.enabled },
          ])
        }
        deps.onChanged?.()
        return toApi(record, await isAvailable(userId, record))
      } catch (err) {
        // Renaming onto a name that already exists in this scope violates the
        // (user, scope, name) unique index — surface it instead of a 500.
        if (/unique|constraint/i.test(errorMessage(err))) {
          throw new ApiError(
            409,
            'mcp_name_conflict',
            `An MCP server named "${input.name}" already exists in this scope.`,
          )
        }
        throw err
      }
    },

    async onPolicyChanged() {
      // A server's rules are the whole of its availability, so there is nothing to write
      // here — only the other screens to tell, and the run-scope caches to invalidate.
      deps.onChanged?.()
    },

    async setServerEnabled(userId, id, enabled, agentId) {
      const record = await repo.getById(userId, id)
      if (!record) throw new ApiError(404, 'mcp_not_found', 'MCP server not found')
      await availabilityWriter.set(userId, agentId || DEFAULT_AGENT_ID, 'mcp', [
        { name: record.name, enabled },
      ])
      deps.onChanged?.()
      return toApi(record, enabled)
    },

    async deleteServer(userId, id) {
      const existing = await repo.getById(userId, id)
      if (!existing) throw new ApiError(404, 'mcp_not_found', 'MCP server not found')
      await repo.delete(userId, id)
      deps.onChanged?.()
    },

    async testServer(userId, id) {
      const record = await repo.getById(userId, id)
      if (!record) throw new ApiError(404, 'mcp_not_found', 'MCP server not found')
      const cwd = await cwdFor(userId, record.projectId)
      return probeMcpServer(record, cwd)
    },

    async importServers(userId, payload, projectId) {
      const normalized = normalizeMcpServersJson(
        payload.mcpServers,
        projectId,
        payload.defaultEnabled ?? true,
      )
      const created: McpServer[] = []
      const errors: Array<{ name: string; error: string }> = []
      for (const entry of normalized) {
        if (!entry.input) {
          errors.push({ name: entry.name, error: entry.error ?? 'invalid server entry' })
          continue
        }
        try {
          const server = await this.createServer(userId, entry.input)
          created.push(server)
          // A `.mcp.json` may narrow a server to some of its tools. That is policy, so it
          // lands as `mcp:<server>/<tool>` rules rather than as fields on the record —
          // carrying it into the config would have recreated the second store this feature
          // just lost, and dropping it would silently ignore what the imported file asked for.
          const changes = importedToolRules(server.name, entry.input.config)
          if (changes.length > 0) {
            await availabilityWriter.apply(userId, DEFAULT_AGENT_ID, changes)
          }
        } catch (err) {
          errors.push({ name: entry.name, error: errorMessage(err) })
        }
      }
      return { created, errors }
    },

    async listForRuntime(userId, projectId) {
      return repo.listForScope(userId, projectId)
    },

    async startServerOAuth(userId, id) {
      const record = await repo.getById(userId, id)
      if (!record) throw new ApiError(404, 'mcp_not_found', 'MCP server not found')
      if (record.transport !== 'http') {
        throw new ApiError(
          400,
          'mcp_oauth_unsupported',
          'OAuth is only supported for remote (http) MCP servers',
        )
      }
      try {
        return await startMcpOAuth(record)
      } catch (err) {
        throw new ApiError(
          400,
          'mcp_oauth_failed',
          `Sign-in to "${record.name}" could not be started (${errorMessage(err)})`,
        )
      }
    },

    async finishServerOAuth(state, code) {
      const result = await finishMcpOAuth(state, code)
      // Storing tokens flips the record's `oauthStatus`, which a capability snapshot
      // carries — so signing in changes the snapshot even though no server row moved.
      if (result.ok) deps.onChanged?.()
      return result
    },

    async logoutServerOAuth(userId, id) {
      const record = await repo.getById(userId, id)
      if (!record) throw new ApiError(404, 'mcp_not_found', 'MCP server not found')
      await mcpOAuthStore.clear(userId, id)
      deps.onChanged?.()
    },
  }
}
