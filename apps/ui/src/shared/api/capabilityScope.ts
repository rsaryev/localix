import type { CapabilityScope } from './contracts'

/**
 * A capability scope as ONE string, and the only place that reads it.
 *
 * Every capability surface — the picker, the snapshot cache, the toggle queue, the
 * navigation URI — carries the scope as a bare string. A tagged string keeps one cache key,
 * one memo dependency and one URL segment; splitting it into two fields would have meant
 * touching every one of those and getting the pair right at each.
 *
 * The two halves answer DIFFERENT questions, and the server reads them that way:
 *
 *   a project id  — what is LISTED: the plugins, MCP servers and skills installed there.
 *   `agent:<id>`  — whose RULES are read and written. Rules belong to an agent and to
 *                   nothing else; a request that names none is answered for the agent that
 *                   always exists, so nothing ever resolves to "nobody".
 *
 * `''` is "no project named". A project id could in principle start with `agent:`, so the
 * prefix is checked, never searched for.
 */
export const AGENT_SCOPE_PREFIX = 'agent:'

/** The scope string that names one agent. */
export const agentScopeValue = (agentId: string) => `${AGENT_SCOPE_PREFIX}${agentId}`

/** Split a scope string into the wire's two fields. */
export function parseCapabilityScope(scope: string): CapabilityScope {
  return scope.startsWith(AGENT_SCOPE_PREFIX)
    ? { projectId: null, agentId: scope.slice(AGENT_SCOPE_PREFIX.length) }
    : { projectId: scope || null, agentId: null }
}

/** The agent a scope names, or null when it names a project or no project at all. */
export const scopeAgentId = (scope: string): string | null =>
  scope.startsWith(AGENT_SCOPE_PREFIX) ? scope.slice(AGENT_SCOPE_PREFIX.length) : null
