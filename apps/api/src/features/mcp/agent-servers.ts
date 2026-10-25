import { isRecord } from '../../lib/record'
import { normalizeMcpServerEntry } from './normalize'
import type { McpServerRecord } from './repository'

/**
 * THE MCP SERVERS OF A SUBAGENT'S FILE (sub-agents.md, `mcpServers`): a string names a server that
 * is already configured, which the subagent shares with its parent; a map `{ name: definition }` is
 * an inline server in `.mcp.json`'s shape, connected when the subagent starts and disconnected when
 * it finishes. Only the person's own agent files carry them: a plugin's agent loads without. A
 * project file's inline servers also wait for its folder's trust, since each is a command to run.
 */
export interface AgentMcpServers {
  /** Names of configured servers: they stay as the run already reaches them. */
  references: string[]
  /** Servers this agent defines, to connect for its run alone. */
  inline: McpServerRecord[]
  /** Inline entries that cannot load (no url, no command, an untrusted project). */
  skipped: string[]
}

export function agentMcpServers(
  entries: readonly unknown[] | undefined,
  options: {
    userId: string
    projectId: string
    agent: string
    source: string
    projectTrusted: boolean
  },
): AgentMcpServers {
  const out: AgentMcpServers = { references: [], inline: [], skipped: [] }
  const own = ['user', 'project', 'managed'].includes(options.source)
  if (!own) return out
  for (const entry of entries ?? []) {
    if (typeof entry === 'string' && entry.trim()) {
      out.references.push(entry.trim())
      continue
    }
    if (!isRecord(entry)) continue
    for (const [name, raw] of Object.entries(entry)) {
      if (options.source === 'project' && !options.projectTrusted) {
        out.skipped.push(name)
        continue
      }
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
  }
  return out
}
