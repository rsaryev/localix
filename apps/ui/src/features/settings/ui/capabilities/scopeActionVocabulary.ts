import { useMemo } from 'react'
import type { CapabilitySnapshot } from '@/shared/api/contracts'
import { capabilityAction, mcpToolAction } from '@/shared/contrib/capabilityRules'

export interface ScopeActionVocabulary {
  /** Every action the scope could name, already prefixed. */
  actions: string[]
  /** Agent ids — the RESOURCE an `invocation:<host>` rule is about. */
  agentIds: string[]
  /** Invocation hosts the installation knows (`chat`, `delegation`, `automation`, …). */
  invocationHosts: string[]
  /**
   * The whole rule grammar, straight from the snapshot: what each prefix addresses, what the
   * effects do, the named classes, and the worked examples.
   *
   * Passed through rather than restated. The server owns the grammar, so a kind, a class or
   * an effect it learns is one the editor explains and offers the same day — and nothing here
   * names any of them.
   */
  grammar: CapabilitySnapshot['grammar']
}

const EMPTY: ScopeActionVocabulary = {
  actions: [],
  agentIds: [],
  invocationHosts: [],
  grammar: { kinds: [], effects: [], classes: [], examples: [] },
}

/**
 * What the rules editor can suggest, read from the scope's own snapshot.
 *
 * The editor used to be offered tool names and nothing else, so a rule about a skill, a
 * plugin or an MCP server had to be typed from memory with the prefix spelled correctly —
 * and a typo produced a rule that parsed, saved, and matched nothing. Every kind the store
 * accepts is now one keystroke away, built from the same document the registry tabs render.
 *
 * MCP contributes twice on purpose: the server (`mcp:github`), which is the switch, and each
 * of its tools (`mcp:github/create_pr`), which is the narrowing only this screen can express.
 */
export function useScopeActionVocabulary(
  snapshot: CapabilitySnapshot | null,
): ScopeActionVocabulary {
  return useMemo(() => {
    if (!snapshot) return EMPTY
    const actions = [
      ...snapshot.tools.catalog.map((tool) => capabilityAction('tool', tool.name)),
      ...snapshot.skills.map((skill) => capabilityAction('skill', skill.name)),
      ...snapshot.plugins.map((plugin) => capabilityAction('plugin', plugin.name)),
      ...snapshot.mcp.map((server) => capabilityAction('mcp', server.name)),
      ...snapshot.tools.mcp.flatMap((server) =>
        server.tools.map((tool) => mcpToolAction(server.serverName, unnamespace(server, tool))),
      ),
      ...snapshot.agents.map((agent) => capabilityAction('agent', agent.record.id)),
    ]
    return {
      grammar: snapshot.grammar,
      actions: [...new Set(actions)],
      agentIds: snapshot.agents.map((agent) => agent.record.id),
      invocationHosts: [
        ...new Set(snapshot.agents.flatMap((agent) => Object.keys(agent.invocations))),
      ],
    }
  }, [snapshot])
}

/**
 * The snapshot lists the names the MODEL sees (`mcp_github_create_pr`, disambiguated); a rule
 * names the tool as the SERVER calls it. Strip the prefix the namespacing added, and fall
 * back to the whole name when it is not there — a suggestion that is slightly wrong is worth
 * more than a missing one, and the field accepts anything the schema does.
 */
function unnamespace(server: { serverName: string }, toolName: string): string {
  const prefix = `mcp_${server.serverName.replace(/[^a-zA-Z0-9_]/g, '_')}_`
  return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName
}
