import { claudeCodeHome } from '../../../cc-settings/config-dir'
import type { AgentTool } from '@localixai/agent/agents'
import type { AvailabilityReader } from '../../../capabilities/availability'

import {
  mcpClientManager,
  RequiredMcpServersError,
  type McpGatherResult,
} from '../../../mcp/client-manager'
import { buildMcpResourceTools } from '../../../mcp/mcp-resource-tools'
import { claudeCodeMcpServers } from '../../../mcp/claude-code-servers'
import { hydrateMcpRecords } from '../../../mcp/store-secrets'
import type { SessionRecord } from '../../repository'
import { prefixedWarnLogger } from '../plugin-hook-logger'
import type { RunEnv } from './types'

type McpServerList = Awaited<ReturnType<RunEnv['mcpRepo']['listForScope']>>

export interface McpInventoryEntry {
  server: string
  /** The server's loaded tools; assembly names them as the model is offered them (`modelName`). */
  tools: string[]
  /** Optional server is still connecting; its tools may join on the next turn. */
  pending?: boolean
  /**
   * The gather THREW for this run, so the server's tools are absent for a reason that
   * has nothing to do with what the user configured. Without this the model sees no
   * entry at all and reports the capability as one it does not have — which reads to
   * the user as a product limitation rather than the transient failure it is.
   */
  failed?: boolean
  /** Why the server failed to connect, as its connection reported it (Claude Code tells Claude). */
  error?: string
}

export interface ResolvedMcpTools {
  gather?: McpGatherResult
  /** Enabled MCP descriptors used by both model schema and runtime dispatch. */
  tools: AgentTool[]
  /** Per-server capability instructions (CC parity) to surface in the prompt. */
  instructions: Array<{ server: string; text: string }>
  /** Compact model-facing inventory of direct and still-connecting MCP servers. */
  inventory: McpInventoryEntry[]
}

/**
 * Resolve a session's enabled MCP servers (user-registered + plugin-bundled)
 * into AgentTools via the process-lifetime client manager, partitioning them
 * onto the run. An optional server that's down
 * degrades gracefully; a server marked `required:true` fails startup.
 */
export async function resolveMcpTools(args: {
  env: RunEnv
  userId: string
  session: SessionRecord
  pluginMcpServers: McpServerList
  defaultCwd: string
  /** What the run's rules say about its MCP servers. */
  availability: AvailabilityReader
  /** The agent those rules belong to: its servers are its own gather scope. */
  agentId?: string
  /** Whether a channel among the servers speaks into this session; false for a delegated child. */
  bindChannels?: boolean
}): Promise<ResolvedMcpTools> {
  const { env, userId, session, pluginMcpServers, defaultCwd, availability } = args
  const empty: ResolvedMcpTools = {
    tools: [],
    instructions: [],
    inventory: [],
  }
  // Named outside the try so the catch can still say WHICH servers went missing.
  let enabledServers: McpServerList = []
  try {
    const mcpServers = await hydrateMcpRecords(
      userId,
      await env.mcpRepo.listForScope(userId, session.projectId ?? ''),
    )
    // Availability is a rule now, composed across global / project / agent — so a server
    // this agent may not reach is dropped here, and the connection is never opened. A
    // server nobody has ruled on is available: it exists because the user added it.
    //
    // Plugin-bundled servers go through the SAME filter. Their plugin being enabled is what
    // admitted them, but the rules editor happily writes `mcp:<plugin>_<server>` and a rule
    // that is written, listed and then ignored is worse than one that cannot be written at
    // all. The plugins this run may not reach contributed no servers to begin with.
    //
    // The servers of Claude Code's own files for this folder join them (`mcp/claude-code-servers.ts`:
    // `~/.claude.json`, an approved `.mcp.json`, the organization's managed servers), and the
    // organization's allow and deny lists apply to all.
    const servers = claudeCodeMcpServers({
      own: mcpServers,
      plugins: pluginMcpServers,
      userId,
      projectId: session.projectId ?? '',
      cwd: defaultCwd,
      homeDir: claudeCodeHome(),
    })
    enabledServers = servers.filter(
      (server) => availability.effectFor('mcp', server.name) !== 'deny',
    )
    // No early return for an empty list: the gather is what drops this scope's servers and
    // stops the stdio children no scope references any more (a plugin disabled mid-session).
    const gather = await mcpClientManager.gather(enabledServers, {
      cwd: defaultCwd,
      // Per-tool policy, from the same chain that admitted the server. A server nobody has
      // narrowed keeps every tool it offers; `mcp:github/*` denies a family, and one
      // `mcp:github/create_pr` allow after it carves the exception back out.
      toolPolicy: (serverName, toolName) =>
        availability.effectFor('mcp', `${serverName}/${toolName}`) !== 'deny',
      // Include the cwd in the scope key: two sessions rooted differently in the SAME project
      // connect at DIFFERENT cwds (→ distinct cache keys). Keying the scope on
      // project only would make each session's gather overwrite the other's scope
      // set, so invalidation would evict the other session's still-live client
      // every turn (churn + orphaned stdio respawns). Per-cwd scopes pin both.
      // The agent too: availability is read per agent, so two chats in one project and cwd can
      // reach different servers. A shared scope let one chat's gather (an empty one, when its
      // agent reaches no server) drop and stop the other chat's live clients mid-call.
      scope: `${userId}:${session.projectId ?? ''}:${defaultCwd}:${args.agentId ?? ''}`,
      // A Claude Code channel among these servers speaks into this conversation from now on. A
      // delegated child that gathers them (`tool-assembly.ts`) never takes a channel from the chat
      // that started it.
      ...(args.bindChannels === false
        ? {}
        : { channelTarget: { userId, sessionId: session.id, projectId: session.projectId ?? '' } }),
      logger: prefixedWarnLogger('mcp'),
    })
    // Keep descriptors intact. Assembly's shared ledger owns tool policy, authority and
    // model filtering, including the explanation for a withheld dynamic tool.
    const candidateTools = gather.tools
    // Resource tools (Codex parity): for servers advertising `resources`, expose
    // list resources/templates + read resource directly.
    const resourceTools = buildMcpResourceTools({
      resourceServers: gather.resourceServers,
      servers: enabledServers,
      cwd: defaultCwd,
      disabledTools: new Set(),
      manager: mcpClientManager,
    })
    const directByServer = new Map<string, string[]>()
    for (const tool of candidateTools) {
      const server = gather.serverByTool[tool.name]
      if (!server) continue
      const names = directByServer.get(server) ?? []
      names.push(tool.name)
      directByServer.set(server, names)
    }
    const inventory: McpInventoryEntry[] = []
    for (const server of gather.servers) {
      const tools = directByServer.get(server.name) ?? []
      if (server.pending) inventory.push({ server: server.name, tools: [], pending: true })
      else if (server.error)
        inventory.push({ server: server.name, tools: [], failed: true, error: server.error })
      else if (tools.length > 0) inventory.push({ server: server.name, tools })
    }
    return {
      gather,
      tools: [...candidateTools, ...resourceTools],
      instructions: gather.instructions,
      inventory,
    }
  } catch (err) {
    // `required:true` is an explicit startup contract. Preserve the manager's
    // typed failure so the run cannot silently start without that server.
    if (err instanceof RequiredMcpServersError) throw err
    console.warn('[agent-runner] MCP tool gather failed', err)
    // Tell the MODEL too. Logging alone leaves it with a silently shorter tool list and
    // no way to tell "this server is down this turn" from "this product cannot do that".
    return {
      ...empty,
      inventory: enabledServers.map((server) => ({ server: server.name, tools: [], failed: true })),
    }
  }
}
