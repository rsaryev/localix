import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { errorMessage } from '../../lib/errors'
import type { McpServerRecord } from './repository'
import { isMcpAuthenticationRequiredError, type McpClientLike } from './mcp-wire'
import { listToolDefs, withDiscoveryRetry } from './mcp-tool-discovery'
import { mcpConnectionKey as keyFor } from './mcp-connection-key'
import type { McpConnectionObserver } from '../notifications/conditions/mcp'
import type { ToolMetadataStore } from './mcp-tool-metadata-store'
import type { CacheEntry, ClientConnection, McpLogger } from './client-manager-types'

/** CC caps server instructions at 2KB before they reach the model. */
const MCP_INSTRUCTIONS_MAX_CHARS = 2_000

export interface ConnectionPoolDeps {
  connect: (server: McpServerRecord, cwd: string) => Promise<McpClientLike>
  metadata: ToolMetadataStore
  startupTimeoutMs: number
  /** Read on every connect outcome; set once by the composition root. */
  observer: () => McpConnectionObserver | undefined
}

export interface AcquiredConnection {
  entry: CacheEntry
  connection: ClientConnection
  cached: boolean
}

export interface ConnectionPool {
  cache: Map<string, CacheEntry>
  isAlive(entry: CacheEntry): boolean
  evict(entry: CacheEntry): Promise<void>
  acquire(server: McpServerRecord, cwd: string, logger?: McpLogger): Promise<AcquiredConnection>
}

function capInstructions(raw: string | undefined): string | undefined {
  return typeof raw === 'string' && raw.trim()
    ? raw.trim().slice(0, MCP_INSTRUCTIONS_MAX_CHARS)
    : undefined
}

/** Connection lifecycle: single-flight connect, startup deadline, health, eviction. */
export function createConnectionPool(deps: ConnectionPoolDeps): ConnectionPool {
  const { connect, metadata, startupTimeoutMs } = deps
  const cache = new Map<string, CacheEntry>()

  function isAlive(entry: CacheEntry): boolean {
    if (entry.broken) return false
    const client = entry.connection?.client
    // The SDK Client exposes its transport; `undefined` after close.
    if (client && 'transport' in client) return Boolean(client.transport)
    return true
  }

  async function evict(entry: CacheEntry): Promise<void> {
    if (cache.get(entry.key) === entry) cache.delete(entry.key)
    entry.broken = true
    const connection = entry.connection ?? (await entry.promise.catch(() => undefined))
    await connection?.client.close().catch(() => {})
  }

  function startEntry(
    server: McpServerRecord,
    cwd: string,
    key: string,
    logger?: McpLogger,
  ): CacheEntry {
    let startupClient: McpClientLike | undefined
    let startupExpired = false
    const timeoutMessage = `MCP server "${server.name}" startup timed out after ${startupTimeoutMs}ms`
    // `entry` is declared below; `run` only touches it after its first await.
    const run = async (): Promise<ClientConnection> => {
      const client = await connect(server, cwd)
      startupClient = client
      if (startupExpired) {
        await client.close().catch(() => {})
        throw new Error(timeoutMessage)
      }
      try {
        // Install the close handler BEFORE any further await: a transport that
        // drops during listTools() below would otherwise close before `broken` is
        // wired, leaving a dead client cached as "alive" until a tool call fails.
        const previousOnClose = client.onclose
        client.onclose = () => {
          entry.broken = true
          previousOnClose?.()
        }
        // CC `list_changed`: when the server announces its tool list changed,
        // re-list in place (best-effort) so the next gather sees the new tools
        // without a disconnect/reconnect. Failure just leaves the cached list.
        client.setNotificationHandler?.(ToolListChangedNotificationSchema, () => {
          void listToolDefs(client)
            .then((defs) => {
              if (entry.connection) entry.connection.toolDefs = defs
              metadata.reconcile(key, server.name, defs, logger)
            })
            .catch(() => {})
        })
        const toolDefs = await withDiscoveryRetry(() => listToolDefs(client))
        metadata.reconcile(key, server.name, toolDefs, logger)
        const instructions = capInstructions(client.getInstructions?.())
        const connection: ClientConnection = { client, toolDefs, instructions }
        entry.connection = connection
        return connection
      } catch (err) {
        // Crumple-zone release (Release It! — a failure must not leak a resource):
        // `connect` already succeeded here, so a stdio server has a spawned child /
        // an open transport. A later step (tool discovery) throwing rejects this
        // entry and the `.catch` below evicts it — but `entry.connection` was never
        // set, so eviction can't close the client. Release it explicitly before
        // rethrowing so the orphaned process/transport can't outlive the failed connect.
        await client.close().catch(() => {})
        throw err
      }
    }
    const withStartupDeadline = (): Promise<ClientConnection> => {
      const startup = run()
      const timeout = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          startupExpired = true
          void startupClient?.close().catch(() => {})
          reject(new Error(timeoutMessage))
        }, startupTimeoutMs)
        timer.unref?.()
        void startup.finally(() => clearTimeout(timer)).catch(() => {})
      })
      // Promise.race installs rejection handlers on both branches, so a connector
      // that settles after the deadline cannot emit an unhandled rejection.
      return Promise.race([startup, timeout])
    }
    const entry: CacheEntry = {
      key,
      serverName: server.name,
      broken: false,
      promise: withStartupDeadline(),
    }
    // A failed connect must not be cached — the next gather retries fresh.
    entry.promise.catch(() => {
      if (cache.get(key) === entry) cache.delete(key)
    })
    // Every connect's outcome, so a server that never connects is a standing row for a person
    // rather than a log line per turn (`notifications/conditions/mcp.ts`).
    entry.promise.then(
      () => deps.observer()?.connected(server),
      (err: unknown) =>
        deps.observer()?.failed(server, errorMessage(err), isMcpAuthenticationRequiredError(err)),
    )
    cache.set(key, entry)
    return entry
  }

  /** Get a healthy connection for `server`, reconnecting at most once if broken. */
  async function acquire(
    server: McpServerRecord,
    cwd: string,
    logger?: McpLogger,
  ): Promise<AcquiredConnection> {
    const key = keyFor(server, cwd)
    let cached = true
    let entry = cache.get(key)
    if (entry?.connection && !isAlive(entry)) {
      await evict(entry)
      entry = undefined
    }
    if (!entry) {
      entry = startEntry(server, cwd, key, logger)
      cached = false
    }
    let connection = await entry.promise
    if (!isAlive(entry)) {
      // Broke between resolution and use — dispose, evict, reconnect once.
      await evict(entry)
      entry = startEntry(server, cwd, key, logger)
      cached = false
      connection = await entry.promise
    }
    return { entry, connection, cached }
  }

  return { cache, isAlive, evict, acquire }
}
