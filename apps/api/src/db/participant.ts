/** Message authorship is absolute; transport roles remain relative to the reader. */
export const USER_PARTICIPANT = 'user' as const
export const SYSTEM_PARTICIPANT = 'system' as const

/** A stable registry identity, never an agent handle. */
export type AgentParticipantRef = `agent:${string}`
export type ParticipantRef =
  | typeof USER_PARTICIPANT
  | typeof SYSTEM_PARTICIPANT
  | AgentParticipantRef

const AGENT_PREFIX = 'agent:'

export function agentParticipant(agentId: string): AgentParticipantRef {
  if (!agentId) throw new Error('Agent identity is required')
  return `${AGENT_PREFIX}${agentId}`
}

export function isAgentParticipant(ref: string): ref is AgentParticipantRef {
  return ref.startsWith(AGENT_PREFIX) && ref.length > AGENT_PREFIX.length
}

export function participantAgentId(ref: string): string | null {
  return isAgentParticipant(ref) ? ref.slice(AGENT_PREFIX.length) : null
}

/** Missing membership cannot silently attribute a message to the default agent. */
export function conversationAgent(agents: readonly { agentId: string }[]): AgentParticipantRef {
  const agentId = agents?.[0]?.agentId
  if (!agentId) throw new Error('Session has no agent assignment')
  return agentParticipant(agentId)
}

export const DEFAULT_AGENT_HANDLE = 'localix'
export const DEFAULT_AGENT_ID = 'builtin:localix'
export const DEFAULT_AGENT_PARTICIPANT = agentParticipant(DEFAULT_AGENT_ID)
