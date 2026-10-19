/**
 * A TAG BRINGS THE AGENT IN.
 *
 * Addressing an available agent who is not in the conversation yet — by the person or by any
 * participant — invites it, and the address then routes to it like to anyone present. A delegated
 * team never grows this way; an unknown or unavailable handle is just text.
 */
import type { SessionRecord } from '../../repository'
import { addressedHandles } from '../../conversation-addressing'
import { updateConversationMembership } from './conversation-membership'
import { conversationPolicy } from '../../policy/session-policy'
import type { RunEnv } from './types'

export type InviteEnv = {
  repo: RunEnv['repo']
  deps: Pick<RunEnv['deps'], 'streamRegistry' | 'listInvocableRegistryAgents'>
  activeAgentId?: (sessionId: string) => string | undefined
}

/** The session after inviting every available agent `text` addresses; unchanged when none. */
export async function inviteAddressedAgents(
  env: InviteEnv,
  userId: string,
  session: SessionRecord,
  text: string,
): Promise<SessionRecord> {
  if (!conversationPolicy(session).tagInvites || !text.includes('@')) return session
  const available =
    (await env.deps.listInvocableRegistryAgents?.(userId, 'chat', session.projectId)) ?? []
  const present = new Set(session.agents.map((member) => member.agentId))
  const newcomers = addressedHandles(
    text,
    available.filter((agent) => !present.has(agent.agentId)).map((agent) => agent.name),
  )
  if (newcomers.length === 0) return session
  const change = await updateConversationMembership(env, {
    userId,
    sessionId: session.id,
    invite: newcomers,
  })
  return change.session
}
