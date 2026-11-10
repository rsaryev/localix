import { isRecord } from '../../lib/record'
import { normalizeMcpServerEntry } from './normalize'
import type { McpServerRecord } from './repository'

/**
 * THE MCP SERVERS OF A SUBAGENT'S FILE (sub-agents.md, `mcpServers`): a string names a server that
 * is already configured, which the subagent shares with its parent; a map `{ name: definition }` is
 * an inline server in `.mcp.json`'s shape, connected when the subagent starts and disconnected when
 * it finishes. Which entries apply is the kit's (`plugins/kit` `agentMcpSpecs`, which the caller
 * runs): a plugin's agent loads without, and a project file's inline servers wait for its folder's
 * trust. This turns each inline one into a server record.
 */
export interface AgentMcpServers {
  /** Names of configured servers: they stay as the run already reaches them. */
  references: string[]
  /** Servers this agent defines, to connect for its run alone. */
  inline: McpServerRecord[]
  /** Inline entries that cannot load (no url, no command, an untrusted project). */
  skipped: string[]
}

/** The entries the kit let apply: references, inline definitions as written, and what waits. */
export interface AgentMcpEntries {
  readonly references: readonly string[]
  readonly inline: Readonly<Record<string, unknown>>
  readonly skipped: readonly string[]
}

export function agentMcpServers(
  specs: AgentMcpEntries,
  options: { userId: string; projectId: string; agent: string },
): AgentMcpServers {
  const out: AgentMcpServers = {
    references: [...specs.references],
    inline: [],
    skipped: [...specs.skipped],
  }
  for (const [name, raw] of Object.entries(specs.inline)) {
    try {
      const parsed = normalizeMcpServerEntry(name, isRecord(raw) ? raw : {}, options.projectId)
      if (parsed.enabled === false) continue
      out.inline.push({
        id: `agent:${options.agent}:${name}`,
        userId: options.userId,
        projectId: options.projectId,
        name: parsed.name,
        description: parsed.description ?? '',
        transport: parsed.transport,
        config: parsed.config as Record<string, unknown>,
        createdAt: '',
        updatedAt: '',
      })
    } catch {
      out.skipped.push(name)
    }
  }
  return out
}
