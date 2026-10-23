/**
 * Database workbench — bundled first-party mini app backend.
 *
 * `register(ctx)` gets (or lazily builds) the process-wide database service and
 * contributes it as a `BackendSubsystem`: the boot-time loader (`loadMiniAppBackends`)
 * mounts the route (`/rpc/database`), registers the resource (`localix://resource/db`) + global-search
 * providers, and calls `onShutdown` on shutdown. The ONE `database_client` agent tool (connections,
 * schema, browse, query and connection management behind an `action`; see `database-tool.ts`)
 * rides the same `register()` return so the orchestrator (an OPEN `openToolset` profile) picks it
 * up as a mini app tool — no core allowlist entry required.
 *
 * The ONE host coupling — resolving `${secret:KEY}` tokens in a connection URL/password/
 * ssh block against the central vault — arrives through the GENERIC mini app host seam
 * `ctx.host.resolveSecret(userId, key)`. The database mini app never imports the core
 * secrets subsystem; the host wires its real resolver into this seam at boot.
 *
 * `onShutdown` closes every live driver (+ SSH tunnel, rolling back any open manual
 * transaction) — the stateful bit this subsystem owns.
 */
import type { AgentTool } from '@localixai/agent/agents'
import { join } from 'node:path'
import { createStoreChangeFeed, safeFileKey } from '@localixai/mini-app-sdk/backend'
import type { MiniAppContext, MiniAppRegistration } from '@localixai/mini-app-sdk/backend'
import {
  currentDatabaseService,
  releaseDatabaseService,
  subscribeDatabaseWrites,
  invalidateDatabaseSnapshot,
} from './singleton'
import { createDatabaseRoutes } from './routes'
import { createDatabaseResourceProvider } from './resource-provider'
import { createDatabaseSearchProvider } from './search-provider'
import {
  createDatabaseContextProvider,
  createDatabaseAutomaticContextProvider,
} from './context-provider'
import { createDatabaseTool } from './database-tool'

/** The generic host capabilities this mini app reads off the register context. Declared
 *  narrowly (a structural subset of the host `MiniAppContext`) so the mini app stays
 *  decoupled from core mini app internals — the loader passes the full context, of which
 *  this is a subset. */
type DatabaseRegisterContext = Pick<MiniAppContext, 'dataDir' | 'host' | 'userId' | 'watchPath'>

export async function register(ctx: DatabaseRegisterContext): Promise<MiniAppRegistration> {
  // Boot-time call supplies the real vault resolver; per-run tool loads reuse the
  // already-built singleton (whose bound resolver stays live). Resolved per call, never
  // captured — see `currentDatabaseService` for the two-instance split capturing caused.
  const service = currentDatabaseService({
    dataDir: ctx.dataDir,
    resolveSecret: ctx.host?.resolveSecret,
  })
  const feed = createStoreChangeFeed({
    miniApp: 'database',
    resolveDir: async () => ctx.dataDir,
    subscribeWrites: subscribeDatabaseWrites,
    watchPath: ctx.watchPath ?? ctx.host?.watchPath,
    onExternalChange: invalidateDatabaseSnapshot,
    acceptPath: (userId, file) => file === join(ctx.dataDir, `${safeFileKey(userId)}.json`),
  })
  const userId = ctx.userId

  // The mini app's ONE agent tool (`database-tool.ts`): each verb's narrow port over the shared
  // service, so every body stays testable with a fake.
  const listConnections = (u: string) => service.list(u)
  const databaseTool: AgentTool = createDatabaseTool({
    userId,
    ports: {
      query: {
        listConnections,
        runQuery: async (u, id, sql, signal) => {
          const r = await service.query(u, id, sql, undefined, signal ? { signal } : undefined)
          return r ? r.result : null
        },
      },
      schema: {
        listConnections,
        schemas: async (u, id) => {
          const r = await service.schemas(u, id)
          return r ? r.schemas : null
        },
        tableSchema: async (u, id, schema, table) => {
          const r = await service.tableSchema(u, id, schema, table)
          return r ? r.table : null
        },
      },
      browse: {
        listConnections,
        browse: async (u, id, request, signal) => {
          const response = await service.browse(u, id, request, signal ? { signal } : undefined)
          return response ? response.result : null
        },
      },
      connections: {
        list: listConnections,
        connect: (u, req) => service.connect(u, req),
        test: (u, config) => service.testConnection(u, config),
        reconnect: (u, id) => service.reconnect(u, id),
        disconnect: (u, id) => service.disconnect(u, id),
        remove: (u, id) => service.remove(u, id),
      },
    },
  })

  return {
    backend: [
      {
        id: 'database:backend',
        routeMount: { path: '/rpc/database', app: createDatabaseRoutes(service) },
        resourceProvider: createDatabaseResourceProvider(service),
        searchProvider: createDatabaseSearchProvider({
          listConnections: async (u) =>
            (await service.list(u)).map((c) => ({ id: c.id, name: c.name, dialect: c.dialect })),
        }),
        contextProviders: [
          // Explicit: a linked localix://resource/db resource resolves to schema/entity text (chat + prediction).
          createDatabaseContextProvider(service),
          // Automatic: bounded active-schema summary for a SQL editor buffer (prediction
          // only, default-off — the reference for the explicit-vs-automatic split).
          createDatabaseAutomaticContextProvider(service),
        ],
        // Release, not just close: the host unwires on a reload too and registers again, and a
        // closed singleton would refuse every connect after that (see `releaseDatabaseService`).
        wsFrames: feed.wsFrames,
        onShutdown: async () => {
          feed.onShutdown()
          await releaseDatabaseService()
        },
      },
    ],
    tools: [databaseTool],
  }
}
