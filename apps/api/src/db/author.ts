/** Message authorship is absolute; transport roles remain relative to the reader. */
export const USER_AUTHOR = 'user' as const
export const SYSTEM_AUTHOR = 'system' as const

/** A stable registry identity, never an agent handle. */
export type AgentAuthorRef = `agent:${string}`
export type AuthorRef = typeof USER_AUTHOR | typeof SYSTEM_AUTHOR | AgentAuthorRef

const AGENT_PREFIX = 'agent:'

export function agentAuthor(agentId: string): AgentAuthorRef {
  if (!agentId) throw new Error('Agent identity is required')
  return `${AGENT_PREFIX}${agentId}`
}

export function isAgentAuthor(ref: string): ref is AgentAuthorRef {
  return ref.startsWith(AGENT_PREFIX) && ref.length > AGENT_PREFIX.length
}

export function authorAgentId(ref: string): string | null {
  return isAgentAuthor(ref) ? ref.slice(AGENT_PREFIX.length) : null
}

export const DEFAULT_AGENT_NAME = 'localix'
export const DEFAULT_AGENT_ID = 'builtin:localix'
export const DEFAULT_AGENT_AUTHOR = agentAuthor(DEFAULT_AGENT_ID)
