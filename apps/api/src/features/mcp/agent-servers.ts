import type { McpServerRecord } from './repository'

/**
 * THE MCP SERVERS OF A SUBAGENT'S FILE (sub-agents.md, `mcpServers`): a string names a server that
 * is already configured, which the subagent shares with its parent; a map `{ name: definition }` is
 * an inline server in `.mcp.json`'s shape, connected when the subagent starts and disconnected when
 * it finishes. Which entries apply is the kit's (`plugins/kit` `agentMcpSpecs`, which the caller
 * runs): a plugin's agent loads without, and a project file's inline servers wait for its folder's
 * trust, and the kit reads each inline entry (`readServerShape`). This makes them this run's records.
 */
export interface AgentMcpServers {
  /** Names of configured servers: they stay as the run already reaches them. */
  references: string[]
  /** Servers this agent defines, to connect for its run alone. */
  inline: McpServerRecord[]
  /** Inline entries that cannot load (no url, no command, an untrusted project). */
  skipped: string[]
}

/** The entries the kit let apply: references, inline servers it read, and what waits. */
export interface AgentMcpEntries {
  readonly references: readonly string[]
  readonly inline: Readonly<Record<string, Pick<McpServerRecord, 'name' | 'transport' | 'config'>>>
  readonly skipped: readonly string[]
}

export function agentMcpServers(
  specs: AgentMcpEntries,
  options: { userId: string; projectId: string; agent: string },
): AgentMcpServers {
  return {
    references: [...specs.references],
    inline: Object.entries(specs.inline).map(([name, shape]) => ({
      ...shape,
      id: `agent:${options.agent}:${name}`,
      userId: options.userId,
      projectId: options.projectId,
      description: '',
      createdAt: '',
      updatedAt: '',
    })),
    skipped: [...specs.skipped],
  }
}
