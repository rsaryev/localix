import type { AgentTool } from '@localixai/agent/agents'

import { gathersMcpTools } from '../../../agent-core/run-shape'
import { externalToolSurface } from './external-tool-surface'
import { resolveMcpTools, type McpInventoryEntry } from './mcp-tools'
import type { AssembleRunToolsOptions } from './tool-assembly'
import { claimSecondaryTools } from './tool-namespace'

/**
 * The MCP half of a run's tool assembly: the servers' tools gathered, held to the run's external
 * surface, and appended to `allTools` where no runtime tool owns the name — with the instructions
 * and inventory of only the servers whose tools were accepted.
 */
export async function gatherRunMcpTools(options: AssembleRunToolsOptions, allTools: AgentTool[]) {
  // ---- MCP tools (persistent clients) ----------------------------------
  // Resolve the user's enabled MCP servers to AgentTools via the process-
  // lifetime client manager: connects (and lists tools) only on first use
  // or after a config change / broken transport, then reuses the cached
  // client — keeping slow stdio spawns off the per-message critical path.
  // An optional server that's down degrades gracefully (its tools are absent);
  // `required:true` servers fail startup. Servers removed/disabled since the last
  // gather get their clients disposed by the manager. Disabled tools are
  // filtered by the registry's allow-list, mirroring built-in tools.
  // Only an OPEN toolset, or a list naming an MCP tool, gathers (`run-shape.ts`): a closed
  // worker would pay every server's connect cost and schemas for tools it never uses.
  const mcp = gathersMcpTools(options.agentProfile)
    ? await resolveMcpTools({
        env: options.env,
        userId: options.userId,
        session: options.session,
        pluginMcpServers: options.loadedPlugins.mcpServers,
        defaultCwd: options.defaultCwd,
        availability: options.availability,
        agentId: options.agentId,
        bindChannels: options.agentProfile.shape === 'chat',
        ...(options.agentServers ? { agentServers: options.agentServers } : {}),
      })
    : {
        gather: undefined,
        tools: [],
        instructions: [],
        inventory: [],
      }
  if (mcp.release) options.registerMcpRelease?.(mcp.release)
  const external = externalToolSurface({
    tools: mcp.tools,
    profile: options.agentProfile,
    capabilities: options.capabilities,
    disabledTools: options.disabledTools,
    authority: options.toolSurface,
    modelInput: options.modelInput,
  })
  const claimedMcp = claimSecondaryTools(allTools, external.tools)
  allTools.push(...claimedMcp.tools)
  if (claimedMcp.conflicts.length > 0) {
    console.warn(
      `[agent-runner] Ignoring MCP tools whose names are already owned by the runtime registry: ${claimedMcp.conflicts.join(', ')}`,
    )
  }
  // Each accepted MCP tool's name → the name the model is offered it under (the inventory's).
  const acceptedMcp = new Map(claimedMcp.tools.map((tool) => [tool.name, tool.modelName]))
  const acceptedServers = new Set([...acceptedMcp.keys()].map((n) => mcp.gather?.serverByTool[n]))
  const mcpInstructions = mcp.instructions.filter((entry) => acceptedServers.has(entry.server))
  const mcpInventory: McpInventoryEntry[] = mcp.inventory.flatMap((entry) => {
    if (entry.pending || entry.failed) return [entry]
    const tools = entry.tools.flatMap((n) => (acceptedMcp.has(n) ? [acceptedMcp.get(n) ?? n] : []))
    return tools.length > 0 ? [{ ...entry, tools }] : []
  })
  return { mcp, external, acceptedMcp, mcpInstructions, mcpInventory }
}
