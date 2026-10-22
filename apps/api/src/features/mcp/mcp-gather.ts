import type { AgentTool } from '@localixai/agent/agents'
import { errorMessage } from '../../lib/errors'
import type { McpServerRecord } from './repository'
import {
  buildToolForServer,
  DEFAULT_CONNECT_BUDGET_MS,
  disambiguate,
  filterToolDefs,
  TIMED_OUT,
  withConnectBudget,
  type McpGatherResult,
} from './mcp-wire'
import { mcpConnectionKey as keyFor } from './mcp-connection-key'
import { buildCachedToolForServer } from './mcp-cached-tool'
import type { ConnectionPool } from './mcp-connection-pool'
import type { ToolMetadataStore } from './mcp-tool-metadata-store'
import type { ChannelRouter } from './mcp-channels'
import {
  isRequiredServer,
  RequiredMcpServersError,
  type McpGatherOptions,
  type McpLogger,
  type RequiredMcpServerFailure,
  type ToolListSource,
} from './client-manager-types'

export interface GatherState {
  pool: ConnectionPool
  metadata: ToolMetadataStore
  /** scope → keys referenced by that scope's latest gather. */
  scopeKeys: Map<string, Set<string>>
  defaultLogger?: McpLogger
  channels?: ChannelRouter
}

type ConnectOutcome =
  | { kind: 'skipped'; server: McpServerRecord; result: McpGatherResult['servers'][number] }
  | { kind: 'available'; server: McpServerRecord; source: ToolListSource }

async function connectOne(
  state: GatherState,
  server: McpServerRecord,
  gatherOptions: McpGatherOptions,
  connectBudgetMs: number,
  logger: McpLogger | undefined,
): Promise<ConnectOutcome> {
  const { pool } = state
  try {
    const key = keyFor(server, gatherOptions.cwd)
    let liveEntry = pool.cache.get(key)
    if (liveEntry?.connection && !pool.isAlive(liveEntry)) {
      await pool.evict(liveEntry)
      liveEntry = undefined
    }
    // A lazy collection is only worth activating when it is not already cached: known
    // metadata skips discovery here; `buildCachedToolForServer` starts it on first use.
    if (!isRequiredServer(server) && !liveEntry?.connection) {
      const metadata = state.metadata.get(key)
      // A channel has to be running to push, so it starts now, off this turn's critical path,
      // as Claude Code starts a channel with the session; its tools stay lazy until it is up.
      if (metadata?.channel) void pool.acquire(server, gatherOptions.cwd, logger).catch(() => {})
      if (metadata) return { kind: 'available', server, source: { state: 'Cached', metadata } }
    }

    // Required servers deliberately stay on the startup critical path.
    // Optional servers retain the short background budget.
    const acquired = isRequiredServer(server)
      ? await pool.acquire(server, gatherOptions.cwd, logger)
      : await withConnectBudget(pool.acquire(server, gatherOptions.cwd, logger), connectBudgetMs)
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
      source: { state: 'Live', entry: acquired.entry, connection: acquired.connection },
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
}

/**
 * Resolve the tools of every enabled server in `servers`. A persisted metadata hit
 * contributes lazy tools without starting the server; a live connection contributes
 * direct tools. Unknown servers connect once to discover and persist their first list.
 * Required servers deliberately connect here because `required:true` is an explicit
 * startup contract. Clients are NOT tied to the run — do not dispose them per-run;
 * `disposeAll()` belongs to server shutdown.
 */
export async function gatherTools(
  state: GatherState,
  servers: McpServerRecord[],
  gatherOptions: McpGatherOptions,
): Promise<McpGatherResult> {
  const logger = gatherOptions.logger ?? state.defaultLogger
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
  if (currentKeys.size === 0) state.scopeKeys.delete(gatherOptions.scope ?? '')
  else state.scopeKeys.set(gatherOptions.scope ?? '', currentKeys)

  const channelTarget = gatherOptions.channelTarget
  if (channelTarget)
    state.channels?.bind(
      enabled.map((server) => {
        const key = keyFor(server, gatherOptions.cwd)
        return { key, server, channel: state.metadata.get(key)?.channel === true }
      }),
      {
        target: { userId: channelTarget.userId, sessionId: channelTarget.sessionId },
        cwd: gatherOptions.cwd,
        projectId: channelTarget.projectId ?? '',
        scope: gatherOptions.scope ?? '',
      },
    )

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
  const outcomes = await Promise.all(
    enabled.map((server) => connectOne(state, server, gatherOptions, connectBudgetMs, logger)),
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
    const { server, source } = outcome
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
          : buildCachedToolForServer(state.pool, server, gatherOptions.cwd, def, logger)
      // Disambiguate a namespaced-name collision so neither tool is shadowed.
      // The exposed name changes; execute still dispatches by the original
      // def.name, so renaming is safe.
      const name = disambiguate(built.name, usedToolNames)
      usedToolNames.add(name)
      tools.push(name === built.name ? built : { ...built, name })
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
  for (const keys of state.scopeKeys.values()) for (const key of keys) live.add(key)
  for (const entry of state.pool.cache.values()) {
    if (!live.has(entry.key)) void state.pool.evict(entry)
  }

  return { tools, servers: serverResults, serverByTool, instructions, resourceServers }
}
