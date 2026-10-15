import { errorMessage } from '../../lib/errors'
import type { McpServerRecord } from './repository'
import {
  connectClient,
  disambiguate,
  filterToolDefs,
  isMcpAuthenticationRequiredError,
  modelVisibleToolDefs,
  namespacedName,
  resolveConnectTimeoutMs,
} from './mcp-wire'
import { mcpConnectionKey as keyFor } from './mcp-connection-key'
import type { McpConnectionObserver } from '../notifications/conditions/mcp'
import { createToolMetadataStore } from './mcp-tool-metadata-store'
import { createConnectionPool } from './mcp-connection-pool'
import { gatherTools, type GatherState } from './mcp-gather'
import * as resources from './mcp-resource-access'
import type {
  McpClientManagerOptions,
  McpGatherOptions,
  McpProbeResult,
} from './client-manager-types'

// Re-export the MCP wire surface (helpers + types) so the historical
// `./client-manager` import path stays stable for service.ts and the tests.
export { filterToolDefs, mapCallResult, MCP_DESCRIPTION_MAX_CHARS } from './mcp-wire'
export type { McpClientLike, McpGatherResult, McpToolDef } from './mcp-wire'
export {
  RequiredMcpServersError,
  type McpClientManagerOptions,
  type McpGatherOptions,
  type McpProbeResult,
  type RequiredMcpServerFailure,
} from './client-manager-types'

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
  /** Set once by the composition root: this manager is a process-lifetime module singleton. */
  let connectionObserver: McpConnectionObserver | undefined
  // Injected test managers stay process-local so tests cannot read or mutate the user's cache.
  const metadata = createToolMetadataStore(!options.connect)
  const pool = createConnectionPool({
    connect: options.connect ?? connectClient,
    metadata,
    startupTimeoutMs: Math.max(1, options.startupTimeoutMs ?? resolveConnectTimeoutMs()),
    observer: () => connectionObserver,
  })
  const { cache, acquire, evict } = pool
  const gatherState: GatherState = {
    pool,
    metadata,
    scopeKeys: new Map(),
    defaultLogger: options.logger,
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
        connection && !entry.broken ? connection.toolDefs : metadata.get(key)?.toolDefs
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
    gatherState.scopeKeys.clear()
    const entries = [...cache.values()]
    cache.clear()
    await Promise.all(entries.map((entry) => evict(entry)))
  }

  return {
    gather: (servers: McpServerRecord[], gatherOptions: McpGatherOptions) =>
      gatherTools(gatherState, servers, gatherOptions),
    cachedToolNames,
    listResources: (servers: McpServerRecord[], cwd: string) =>
      resources.listResources(pool, servers, cwd),
    listResourceTemplates: (servers: McpServerRecord[], cwd: string) =>
      resources.listResourceTemplates(pool, servers, cwd),
    readResource: (servers: McpServerRecord[], cwd: string, serverName: string, uri: string) =>
      resources.readResource(pool, servers, cwd, serverName, uri),
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
