import { join } from 'node:path'
import { errorMessage } from '../../lib/errors'
import { localixHome } from '../../lib/env'

import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import type { AgentTool } from '@localixai/agent/agents'
import { stableStringify } from '@localixai/agent'

/** SDK notification schema for `notifications/tools/list_changed`. */
const TOOL_LIST_CHANGED_SCHEMA = ToolListChangedNotificationSchema

import type { McpServerRecord } from './repository'
import {
  buildToolForServer,
  connectClient,
  DEFAULT_CONNECT_BUDGET_MS,
  disambiguate,
  filterToolDefs,
  isMcpAuthenticationRequiredError,
  modelVisibleToolDefs,
  namespacedName,
  resolveConnectTimeoutMs,
  TIMED_OUT,
  withConnectBudget,
  type McpClientLike,
  type McpGatherResult,
  type McpResourceContent,
  type McpResourceDef,
  type McpResourceTemplateDef,
  type McpToolDef,
} from './mcp-wire'
import {
  MAX_PERSISTED_TOOL_LISTS,
  readToolMetadataCache,
  writeToolMetadataCache,
  type ToolMetadataEntry,
} from './mcp-tool-metadata-cache'
import { collectResourcePages } from './mcp-resource-pages'
import { listToolDefs, withDiscoveryRetry } from './mcp-tool-discovery'
import { mcpConnectionKey as keyFor } from './mcp-connection-key'
import { capMcpErrorMessage, resolveMcpResultMaxChars } from './mcp-result'
import type { McpConnectionObserver } from '../notifications/conditions/mcp'

/** CC caps server instructions at 2KB before they reach the model. */
const MCP_INSTRUCTIONS_MAX_CHARS = 2_000

// Re-export the MCP wire surface (helpers + types) so the historical
// `./client-manager` import path stays stable for service.ts and the tests.
export { filterToolDefs, mapCallResult, MCP_DESCRIPTION_MAX_CHARS } from './mcp-wire'
export type { McpClientLike, McpGatherResult, McpToolDef } from './mcp-wire'

interface ClientConnection {
  client: McpClientLike
  /** Listed on (re)connect; re-listed in place on a `tools/list_changed` notification. */
  toolDefs: McpToolDef[]
  /** The server's `InitializeResult.instructions` (capped), surfaced in the prompt. */
  instructions?: string
}

interface CacheEntry {
  key: string
  serverName: string
  /** Single-flight: concurrent gathers for the same key await the same connect. */
  promise: Promise<ClientConnection>
  /** Set once `promise` resolves. */
  connection?: ClientConnection
  /** Flipped by transport close / transport-level call failures. */
  broken: boolean
}

type ToolListSource =
  | {
      state: 'Cached'
      metadata: ToolMetadataEntry
    }
  | {
      state: 'Live'
      entry: CacheEntry
      connection: ClientConnection
    }

/** Extra client surface used past the minimal McpClientLike (optional, best-effort). */
interface McpClientExtras {
  getInstructions?(): string | undefined
  setNotificationHandler?(schema: unknown, handler: () => void): void
}

export interface McpClientManagerOptions {
  /** Injectable for tests; defaults to the real MCP SDK connect. */
  connect?: (server: McpServerRecord, cwd: string) => Promise<McpClientLike>
  logger?: { warn(msg: string, meta?: unknown): void }
  /** Overall connect + discovery deadline; injectable only to keep timeout tests fast. */
  startupTimeoutMs?: number
}

export interface McpGatherOptions {
  cwd: string
  /**
   * Identifies WHOSE server set this gather represents (e.g. `userId:projectId`).
   * A cached client is evicted only when no scope's latest gather references it —
   * so removing a server in one project doesn't kill another project's client.
   */
  scope?: string
  logger?: { warn(msg: string, meta?: unknown): void }
  /**
   * Max time to wait for an optional server before backgrounding it (default
   * {@link DEFAULT_CONNECT_BUDGET_MS}). A required server always stays on the
   * startup path. A backgrounded connect remains cached for the next turn.
   */
  connectBudgetMs?: number
  /**
   * Whether this scope permits one server's tool — the `mcp:<server>/<tool>` rules.
   *
   * Passed in rather than read here for the same reason the enable bit is: this manager
   * caches connections across scopes and knows none of their policy. Absent means no
   * narrowing, which is what a caller with no scope (a health probe) wants.
   */
  toolPolicy?: (serverName: string, toolName: string) => boolean
}

export interface McpProbeResult {
  ok: boolean
  /** Tools active after the user's allow/deny filters. */
  tools: string[]
  /** All model-visible tools advertised by the server, including disabled ones. */
  availableTools?: string[]
  error?: string
  /** True only after the server explicitly challenged the client for OAuth. */
  authRequired?: boolean
}

export interface RequiredMcpServerFailure {
  server: string
  error: string
}

/** A required server is an initialization contract, not a best-effort tool source. */
export class RequiredMcpServersError extends Error {
  readonly failures: readonly RequiredMcpServerFailure[]

  constructor(failures: RequiredMcpServerFailure[]) {
    const details = failures.map(({ server, error }) => `${server}: ${error}`).join('; ')
    super(`required MCP servers failed to initialize: ${details}`)
    this.name = 'RequiredMcpServersError'
    this.failures = failures
  }
}

function isRequiredServer(server: McpServerRecord): boolean {
  return server.config.required === true
}

/**
 * MCP client manager. Connecting an MCP server (especially a stdio `npx …` one)
 * takes seconds and used to happen on EVERY user message, on the critical path
 * before the first model token. The manager keeps live clients across runs and
 * persisted tool metadata across process launches:
 *
 * - **Cache key**: a stable hash of the owning user/record/scope plus everything
 *   that affects the connection (name, transport, expanded config, and cwd for
 *   stdio). Changing a server's config naturally produces a new key → fresh
 *   connect; remote records never leak a token-bearing client across users.
 * - **Health**: before reuse, a cheap liveness check (`broken` flag, flipped by
 *   the client's `onclose` and by transport-level call errors). A broken client
 *   is disposed, evicted, and reconnected once.
 * - **Tool list**: persisted separately from the client, so a cached list can create
 *   lazy model tools without implying the transport is Live.
 * - **Invalidation**: after each gather, clients whose config no longer appears
 *   in any scope's latest gathered set are disposed and evicted.
 * - **Single-flight**: concurrent gathers / first tool calls share one connect per key.
 * - **Isolation**: a failing optional server is recorded and skipped; an explicit
 *   `config.required:true` server keeps startup fail-closed.
 */
export function createMcpClientManager(options: McpClientManagerOptions = {}) {
  const connect =
    options.connect ??
    (async (server: McpServerRecord, cwd: string) =>
      (await connectClient(server, cwd)) as unknown as McpClientLike)
  const cache = new Map<string, CacheEntry>()
  /** Set once by the composition root: this manager is a process-lifetime module singleton. */
  let connectionObserver: McpConnectionObserver | undefined
  const metadataFile = options.connect ? undefined : join(localixHome(), 'mcp-tool-cache.json')
  /**
   * A persisted metadata cache makes a server's tools nameable before it starts, which is
   * only sound while Cached and Live stay distinguishable. Keep metadata separate from `cache`:
   * presence here never implies that a transport is connected.
   *
   * Injected test managers stay process-local so tests cannot read or mutate the user's cache.
   */
  const toolMetadata = metadataFile ? readToolMetadataCache(metadataFile) : new Map()
  /** scope → keys referenced by that scope's latest gather. */
  const scopeKeys = new Map<string, Set<string>>()
  const startupTimeoutMs = Math.max(1, options.startupTimeoutMs ?? resolveConnectTimeoutMs())

  function persistToolMetadata(logger?: { warn(msg: string, meta?: unknown): void }): void {
    writeToolMetadataCache(metadataFile, toolMetadata, logger)
  }

  function getToolMetadata(key: string): ToolMetadataEntry | undefined {
    const metadata = toolMetadata.get(key)
    if (!metadata) return undefined
    // Map insertion order is the LRU order. A read promotes the entry.
    toolMetadata.delete(key)
    toolMetadata.set(key, metadata)
    return metadata
  }

  function reconcileToolMetadata(
    key: string,
    serverName: string,
    liveToolDefs: McpToolDef[],
    logger?: { warn(msg: string, meta?: unknown): void },
  ): void {
    const previous = getToolMetadata(key)
    if (previous && stableStringify(previous.toolDefs) !== stableStringify(liveToolDefs)) {
      const message = `MCP server "${serverName}" live tool list differs from cached metadata`
      const meta = {
        cachedTools: previous.toolDefs.map((tool) => tool.name),
        liveTools: liveToolDefs.map((tool) => tool.name),
      }
      if (logger) logger.warn(message, meta)
      else console.warn(`[mcp] ${message}`, meta)
    }
    toolMetadata.delete(key)
    toolMetadata.set(key, { serverName, toolDefs: liveToolDefs })
    while (toolMetadata.size > MAX_PERSISTED_TOOL_LISTS) {
      const oldest = toolMetadata.keys().next().value
      if (oldest === undefined) break
      toolMetadata.delete(oldest)
    }
    persistToolMetadata(logger)
  }

  function isAlive(entry: CacheEntry): boolean {
    if (entry.broken) return false
    const client = entry.connection?.client
    // The SDK Client exposes its transport; `undefined` after close.
    if (client && 'transport' in (client as object)) {
      return Boolean((client as { transport?: unknown }).transport)
    }
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
    logger?: { warn(msg: string, meta?: unknown): void },
  ): CacheEntry {
    const entry: CacheEntry = {
      key,
      serverName: server.name,
      broken: false,
      promise: undefined as unknown as Promise<ClientConnection>,
    }
    let startupClient: McpClientLike | undefined
    let startupExpired = false
    const startup = (async () => {
      const client = await connect(server, cwd)
      startupClient = client
      if (startupExpired) {
        await client.close().catch(() => {})
        throw new Error(`MCP server "${server.name}" startup timed out after ${startupTimeoutMs}ms`)
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
        const extras = client as unknown as McpClientExtras
        // CC `list_changed`: when the server announces its tool list changed,
        // re-list in place (best-effort) so the next gather sees the new tools
        // without a disconnect/reconnect. Failure just leaves the cached list.
        extras.setNotificationHandler?.(TOOL_LIST_CHANGED_SCHEMA, () => {
          void listToolDefs(client)
            .then((defs) => {
              if (entry.connection) entry.connection.toolDefs = defs
              reconcileToolMetadata(key, server.name, defs, logger)
            })
            .catch(() => {})
        })
        const toolDefs = await withDiscoveryRetry(() => listToolDefs(client))
        reconcileToolMetadata(key, server.name, toolDefs, logger)
        const rawInstr = extras.getInstructions?.()
        const instructions =
          typeof rawInstr === 'string' && rawInstr.trim()
            ? rawInstr.trim().slice(0, MCP_INSTRUCTIONS_MAX_CHARS)
            : undefined
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
    })()
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        startupExpired = true
        void startupClient?.close().catch(() => {})
        reject(
          new Error(`MCP server "${server.name}" startup timed out after ${startupTimeoutMs}ms`),
        )
      }, startupTimeoutMs)
      timer.unref?.()
      void startup.finally(() => clearTimeout(timer)).catch(() => {})
    })
    // Promise.race installs rejection handlers on both branches, so a connector
    // that settles after the deadline cannot emit an unhandled rejection.
    entry.promise = Promise.race([startup, timeout])
    // A failed connect must not be cached — the next gather retries fresh.
    entry.promise.catch(() => {
      if (cache.get(key) === entry) cache.delete(key)
    })
    // Every connect's outcome, so a server that never connects is a standing row for a person
    // rather than a log line per turn (`notifications/conditions/mcp.ts`).
    entry.promise.then(
      () => connectionObserver?.connected(server),
      (err: unknown) =>
        connectionObserver?.failed(
          server,
          errorMessage(err),
          isMcpAuthenticationRequiredError(err),
        ),
    )
    cache.set(key, entry)
    return entry
  }

  /** Get a healthy connection for `server`, reconnecting at most once if broken. */
  async function acquire(
    server: McpServerRecord,
    cwd: string,
    logger?: { warn(msg: string, meta?: unknown): void },
  ): Promise<{ entry: CacheEntry; connection: ClientConnection; cached: boolean }> {
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

  function buildCachedToolForServer(
    server: McpServerRecord,
    cwd: string,
    cachedDef: McpToolDef,
    logger?: { warn(msg: string, meta?: unknown): void },
  ): AgentTool {
    const descriptorClient: McpClientLike = {
      async listTools() {
        return { tools: [] }
      },
      async callTool() {
        throw new Error('cached MCP descriptor executed without acquiring its live server')
      },
      async close() {},
    }
    const descriptor = buildToolForServer(server, descriptorClient, cachedDef)

    return {
      ...descriptor,
      /**
       * Starting the server from inside the tool handler is only safe if the start is
       * idempotent. `acquire` is this
       * manager's idempotent, single-flight equivalent: concurrent first calls share one start,
       * and a rejected start is evicted so the next call can retry.
       */
      async execute(toolCallId, input, signal) {
        let acquired: Awaited<ReturnType<typeof acquire>>
        try {
          acquired = await acquire(server, cwd, logger)
        } catch (err) {
          const maxResultChars = resolveMcpResultMaxChars(cachedDef.maxResultChars)
          const message = capMcpErrorMessage(errorMessage(err), maxResultChars)
          return {
            content: `MCP tool "${cachedDef.name}" failed to start server "${server.name}": ${message}`,
            isError: true,
            error: {
              kind: 'execution',
              message,
              userMessage: `MCP server "${server.name}" failed to start: ${message}`,
              retryable: true,
              fatal: false,
            },
          }
        }

        // A cached descriptor is only an offer to the model, never authority to dispatch.
        // Reconciliation has completed inside `acquire`; resolve the definition from the LIVE
        // list so removed/UI-only/disabled tools fail clearly and changed metadata governs calls.
        // Policy is not re-checked here: the permission gate judges every call against the
        // composed rules, and this list exists to prove the tool still EXISTS on the server.
        const liveDef = filterToolDefs(acquired.connection.toolDefs).find(
          (def) => def.name === cachedDef.name,
        )
        if (!liveDef) {
          const message =
            `cached MCP tool "${cachedDef.name}" is no longer available on server ` +
            `"${server.name}" after reconciling its live tool list`
          return {
            content: message,
            isError: true,
            error: {
              kind: 'execution',
              message,
              userMessage: message,
              retryable: false,
              fatal: false,
            },
          }
        }

        return buildToolForServer(server, acquired.connection.client, liveDef, () => {
          acquired.entry.broken = true
        }).execute(toolCallId, input, signal)
      },
    }
  }

  /**
   * Resolve the tools of every enabled server in `servers`. A persisted metadata hit
   * contributes lazy tools without starting the server; a live connection contributes
   * direct tools. Unknown servers connect once to discover and persist their first list.
   * Required servers deliberately connect here because `required:true` is an explicit
   * startup contract. Clients are NOT tied to the run — do not dispose them per-run;
   * `disposeAll()` belongs to server shutdown.
   */
  async function gather(
    servers: McpServerRecord[],
    gatherOptions: McpGatherOptions,
  ): Promise<McpGatherResult> {
    const logger = gatherOptions.logger ?? options.logger
    // The caller filters. A server record no longer carries an enable bit: availability is
    // a rule composed across global / project / agent, and this manager sees none of them.
    const enabled = servers
    const tools: AgentTool[] = []
    const serverResults: McpGatherResult['servers'] = []
    const serverByTool: Record<string, string> = {}
    const instructions: McpGatherResult['instructions'] = []
    const resourceServers: string[] = []
    // Names already taken THIS gather — used to disambiguate cross-server collisions
    // (sanitize/truncate clashes). Filled in the SEQUENTIAL pass below, so the winner of
    // a collision is decided by the caller's server order, not by who connected first.
    const usedToolNames = new Set<string>()

    // Register this scope's key set BEFORE any await so a concurrent gather's
    // invalidation pass never prunes an entry we are about to use. An empty set
    // (all this scope's servers removed/disabled) is dropped rather than stored —
    // it pins nothing `live`, so keeping it would just retain a dead scope (and
    // its now-orphaned stdio children) and grow the map per user/project forever.
    const currentKeys = new Set(enabled.map((s) => keyFor(s, gatherOptions.cwd)))
    if (currentKeys.size === 0) scopeKeys.delete(gatherOptions.scope ?? '')
    else scopeKeys.set(gatherOptions.scope ?? '', currentKeys)

    const connectBudgetMs = gatherOptions.connectBudgetMs ?? DEFAULT_CONNECT_BUDGET_MS

    /**
     * CONNECT concurrently, ASSEMBLE sequentially.
     *
     * These were one phase, and every result was `push`ed from INSIDE the concurrent map —
     * so the tool list came out in connect-RESOLUTION order, i.e. ordered by network
     * latency. Two costs. The anthropic wire marks the LAST tool definition with
     * `cache_control`, making the whole tool block one cached segment: reshuffle it and the
     * provider re-reads every schema. And `disambiguate` renames whoever arrives SECOND, so
     * on a sanitize/truncate clash — which `mcp-tools.ts` documents as real (`git-hub` and
     * `git_hub` both fold to `mcp_git_hub_*`) — the exposed NAME changed owner between
     * turns: the model learned `mcp_git_hub_search` from one server and later called the
     * other.
     *
     * `Promise.all` preserves INPUT order in its RESULTS; only the side-effecting pushes
     * didn't. The input is already deterministic (DB servers arrive `orderBy('name')`,
     * file servers in their JSON's key order, plugin servers in plugin order), so
     * assembling from the resolved array is all it takes.
     */
    type ConnectOutcome =
      | {
          kind: 'skipped'
          server: McpServerRecord
          result: McpGatherResult['servers'][number]
        }
      | {
          kind: 'available'
          server: McpServerRecord
          source: ToolListSource
        }

    const outcomes = await Promise.all(
      enabled.map(async (server): Promise<ConnectOutcome> => {
        try {
          const key = keyFor(server, gatherOptions.cwd)
          let liveEntry = cache.get(key)
          if (liveEntry?.connection && !isAlive(liveEntry)) {
            await evict(liveEntry)
            liveEntry = undefined
          }
          // A lazy collection is only worth activating when it is not already cached: known
          // metadata skips discovery here; `buildCachedToolForServer` starts it on first use.
          if (!isRequiredServer(server) && !liveEntry?.connection) {
            const metadata = getToolMetadata(key)
            if (metadata) {
              return {
                kind: 'available',
                server,
                source: { state: 'Cached', metadata },
              }
            }
          }

          // Required servers deliberately stay on the startup critical path.
          // Optional servers retain the short background budget.
          const acquired = isRequiredServer(server)
            ? await acquire(server, gatherOptions.cwd, logger)
            : await withConnectBudget(acquire(server, gatherOptions.cwd, logger), connectBudgetMs)
          if (acquired === TIMED_OUT) {
            // Slow/cold connect — leave it running in the background (the cache
            // entry is already registered) and skip this server for THIS turn.
            // Its tools join the next gather once the connect resolves.
            logger?.warn(
              `MCP server "${server.name}" slow to connect (> ${connectBudgetMs}ms) — backgrounded; tools ready next turn`,
            )
            return {
              kind: 'skipped',
              server,
              result: { name: server.name, ok: false, toolCount: 0, cached: false, pending: true },
            }
          }
          return {
            kind: 'available',
            server,
            source: {
              state: 'Live',
              entry: acquired.entry,
              connection: acquired.connection,
            },
          }
        } catch (err) {
          const message = errorMessage(err)
          logger?.warn(`MCP server "${server.name}" failed to connect`, { error: message })
          return {
            kind: 'skipped',
            server,
            result: { name: server.name, ok: false, toolCount: 0, cached: false, error: message },
          }
        }
      }),
    )

    const requiredFailures = outcomes.flatMap((outcome): RequiredMcpServerFailure[] => {
      if (outcome.kind !== 'skipped' || !isRequiredServer(outcome.server)) return []
      return [
        {
          server: outcome.server.name,
          error: outcome.result.error ?? 'initialization did not complete',
        },
      ]
    })
    if (requiredFailures.length > 0) throw new RequiredMcpServersError(requiredFailures)

    for (const outcome of outcomes) {
      if (outcome.kind === 'skipped') {
        serverResults.push(outcome.result)
        continue
      }
      const { server } = outcome
      const { source } = outcome
      if (source.state === 'Live') {
        if (source.connection.instructions) {
          instructions.push({ server: server.name, text: source.connection.instructions })
        }
        if (source.connection.client.getServerCapabilities?.()?.resources) {
          resourceServers.push(server.name)
        }
      }
      // Per-tool policy is applied here (not at connect time) so the cached client keeps the
      // full listing and a rule change applies from the next gather, without reconnecting.
      const visibleDefs = filterToolDefs(
        source.state === 'Live' ? source.connection.toolDefs : source.metadata.toolDefs,
        (toolName) => gatherOptions.toolPolicy?.(server.name, toolName) ?? true,
      )
      for (const def of visibleDefs) {
        const built =
          source.state === 'Live'
            ? buildToolForServer(server, source.connection.client, def, () => {
                source.entry.broken = true
              })
            : buildCachedToolForServer(server, gatherOptions.cwd, def, logger)
        // Disambiguate a namespaced-name collision so neither tool is shadowed.
        // The exposed name changes; execute still dispatches by the original
        // def.name, so renaming is safe.
        const name = disambiguate(built.name, usedToolNames)
        usedToolNames.add(name)
        const tool = name === built.name ? built : { ...built, name }
        tools.push(tool)
        serverByTool[name] = server.name
      }
      serverResults.push({
        name: server.name,
        ok: true,
        toolCount: visibleDefs.length,
        // Existing wire field, now the explicit Cached-vs-Live distinction: true
        // means persisted metadata with no live transport; false means Live.
        cached: source.state === 'Cached',
      })
    }

    // Invalidation: a config that no scope's latest gather references anymore
    // (server removed/disabled, plugin turned off, config edited → new key) gets
    // its client disposed so stdio children don't linger.
    const live = new Set<string>()
    for (const keys of scopeKeys.values()) for (const key of keys) live.add(key)
    for (const entry of cache.values()) {
      if (!live.has(entry.key)) void evict(entry)
    }

    return {
      tools,
      servers: serverResults,
      serverByTool,
      instructions,
      resourceServers,
    }
  }

  /**
   * List resources across the given servers (those advertising the capability),
   * reusing the cached clients from the last gather. Per-server failures are
   * swallowed so one bad server doesn't sink the whole listing.
   */
  async function listResources(
    servers: McpServerRecord[],
    cwd: string,
  ): Promise<Array<McpResourceDef & { server: string }>> {
    const out: Array<McpResourceDef & { server: string }> = []
    const resourcesByServer = await Promise.all(
      servers.map(async (server) => {
        try {
          const { connection } = await acquire(server, cwd)
          if (!connection.client.getServerCapabilities?.()?.resources) return []

          const client = connection.client
          if (!client.listResources) return []
          const resources = await collectResourcePages({
            serverName: server.name,
            operation: 'resources/list',
            async listPage(cursor) {
              const listed = await client.listResources!(
                cursor === undefined ? undefined : { cursor },
                { timeout: resolveConnectTimeoutMs() },
              )
              return { items: listed.resources ?? [], nextCursor: listed.nextCursor }
            },
          })
          return resources.map((resource) => ({ server: server.name, ...resource }))
        } catch {
          /* skip a failing server */
          return []
        }
      }),
    )
    for (const serverResources of resourcesByServer) out.push(...serverResources)
    return out
  }

  /** List resource URI templates, preserving SDK metadata and annotations. */
  async function listResourceTemplates(
    servers: McpServerRecord[],
    cwd: string,
  ): Promise<Array<McpResourceTemplateDef & { server: string }>> {
    const out: Array<McpResourceTemplateDef & { server: string }> = []
    const templatesByServer = await Promise.all(
      servers.map(async (server) => {
        try {
          const { connection } = await acquire(server, cwd)
          if (!connection.client.getServerCapabilities?.()?.resources) return []

          const client = connection.client
          if (!client.listResourceTemplates) return []
          const templates = await collectResourcePages({
            serverName: server.name,
            operation: 'resources/templates/list',
            async listPage(cursor) {
              const listed = await client.listResourceTemplates!(
                cursor === undefined ? undefined : { cursor },
                { timeout: resolveConnectTimeoutMs() },
              )
              return {
                items: listed.resourceTemplates ?? [],
                nextCursor: listed.nextCursor,
              }
            },
          })
          return templates.map((template) => ({ server: server.name, ...template }))
        } catch {
          /* skip a failing server */
          return []
        }
      }),
    )
    for (const serverTemplates of templatesByServer) out.push(...serverTemplates)
    return out
  }

  /** Read one resource by uri from a named server (reusing its cached client). */
  async function readResource(
    servers: McpServerRecord[],
    cwd: string,
    serverName: string,
    uri: string,
  ): Promise<McpResourceContent[]> {
    const server = servers.find((s) => s.name === serverName)
    if (!server) throw new Error(`No connected MCP server named "${serverName}"`)
    const { connection } = await acquire(server, cwd)
    if (!connection.client.readResource)
      throw new Error(`Server "${serverName}" does not support resources`)
    const result = await connection.client.readResource(
      { uri },
      { timeout: resolveConnectTimeoutMs() },
    )
    return result.contents ?? []
  }

  /**
   * Probe through the SAME process-lifetime connection cache used by chat.
   * Settings used to create and immediately close a second SDK client, so a
   * green "Connected" row said nothing about the connection the next run would
   * use and still left the chat path paying the cold-start budget.
   */
  async function probe(server: McpServerRecord, cwd: string): Promise<McpProbeResult> {
    try {
      const { connection } = await acquire(server, cwd)
      return {
        ok: true,
        // A probe reports the SERVER's health, so it lists what the server offers. Which of
        // those this scope permits is a rule, and a rule belongs to a scope the probe has not
        // been given.
        tools: filterToolDefs(connection.toolDefs).map((tool) => tool.name),
        availableTools: modelVisibleToolDefs(connection.toolDefs).map((tool) => tool.name),
      }
    } catch (err) {
      return {
        ok: false,
        tools: [],
        error: errorMessage(err),
        authRequired: isMcpAuthenticationRequiredError(err) || undefined,
      }
    }
  }

  /**
   * The model-facing tool names this scope's servers WOULD contribute, read from the
   * persisted metadata cache and nothing else. No connect, no probe, no network — a settings
   * screen asking "how big is my tool surface" must not be able to start a stdio child.
   *
   * It exists so a count shown before a session's first run can still be honest. The failure it
   * exists to prevent is the one every comparable feature has shipped — "says 128 but the picker
   * shows 118": a UI counting only builtins + plugin tools while the run also
   * sends N MCP tools.
   *
   * The names are produced by the SAME three functions `gather` uses — `filterToolDefs`,
   * `namespacedName`, `disambiguate` — in the same server order, so the estimate cannot drift
   * from the roster. A second implementation of the naming rule is precisely the drift.
   *
   * A server with no live cache entry is NAMED in `unprobed` rather than contributing zero. The
   * caller can then say "at least N, plus 2 servers not yet connected", which is a true statement;
   * silently omitting them would make the count read as complete when it is not.
   */
  function cachedToolNames(
    servers: readonly McpServerRecord[],
    cwd: string,
    toolPolicy?: (serverName: string, toolName: string) => boolean,
  ): {
    servers: Array<{ serverId: string; serverName: string; tools: string[] }>
    unprobed: string[]
  } {
    const withTools: Array<{ serverId: string; serverName: string; tools: string[] }> = []
    const unprobed: string[] = []
    // Shared across servers, exactly as in `gather`: collisions are resolved by server order,
    // so the disambiguating suffix a later server gets depends on what earlier ones took.
    const usedToolNames = new Set<string>()

    for (const server of servers) {
      const key = keyFor(server, cwd)
      const entry = cache.get(key)
      const connection = entry?.connection
      // A broken transport is not Live, but its separately-labelled persisted metadata remains
      // useful as Cached. Keeping those states separate is what prevents an old listing from
      // granting dispatch authority while still allowing the model surface to be assembled.
      const toolDefs =
        connection && !entry.broken ? connection.toolDefs : getToolMetadata(key)?.toolDefs
      if (!toolDefs) {
        unprobed.push(server.name)
        continue
      }
      const tools = filterToolDefs(toolDefs, (toolName) =>
        toolPolicy ? toolPolicy(server.name, toolName) : true,
      ).map((def) => {
        const name = disambiguate(namespacedName(server.name, def.name), usedToolNames)
        usedToolNames.add(name)
        return name
      })
      withTools.push({ serverId: server.id, serverName: server.name, tools })
    }

    return { servers: withTools, unprobed }
  }

  /** Close every cached client (kills stdio children). For server shutdown. */
  async function disposeAll(): Promise<void> {
    scopeKeys.clear()
    const entries = [...cache.values()]
    cache.clear()
    await Promise.all(entries.map((entry) => evict(entry)))
  }

  return {
    gather,
    cachedToolNames,
    listResources,
    listResourceTemplates,
    readResource,
    probe,
    disposeAll,
    observeConnections(observer: McpConnectionObserver | undefined) {
      connectionObserver = observer
    },
    /** Number of cached (or in-flight) clients — exposed for tests/diagnostics. */
    size: () => cache.size,
  }
}

/** Shared process-lifetime manager used by the agent runner. */
export const mcpClientManager = createMcpClientManager()

/** Shared-cache connection probe used by the "Test" button in settings. */
export async function probeMcpServer(
  server: McpServerRecord,
  cwd: string,
): Promise<McpProbeResult> {
  return mcpClientManager.probe(server, cwd)
}
