/**
 * A TAG BRINGS THE AGENT IN.
 *
 * Addressing an available agent who is not in the conversation yet — by the person or by any
 * participant — invites it, and the address then routes to it like to anyone present. A room the
 * person fixed (`rosterLocked`) and a delegated team never grow this way; an unknown or
 * unavailable handle is just text.
 */
import type { SessionRecord } from '../../repository'
import { addressedHandles } from '../../conversation-addressing'
import { updateConversationMembership } from './conversation-membership'
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
  if (!text.includes('@')) return session
  return inviteHandles(env, userId, session, (known) => addressedHandles(text, known))
}

/**
 * The available agents `text` tags who are not in the conversation yet.
 *
 * Membership is the signal, not the wording: tagging someone who is absent can only mean bringing
 * them in, while tagging a participant who is already here is a reference (`handoff` gives the
 * floor). Empty for a fixed room or a delegated team.
 */
export async function taggedNewcomers(
  env: InviteEnv,
  userId: string,
  session: SessionRecord,
  text: string,
): Promise<string[]> {
  if (session.sessionKind !== 'chat' || session.rosterLocked || !text.includes('@')) return []
  const available =
    (await env.deps.listInvocableRegistryAgents?.(userId, 'chat', session.projectId)) ?? []
  const present = new Set(session.agents.map((member) => member.agentId))
  return addressedHandles(
    text,
    available.filter((agent) => !present.has(agent.agentId)).map((agent) => agent.name),
  )
}

/** The session after inviting those of `handles` that are available agents not yet here. */
export async function inviteHandles(
  env: InviteEnv,
  userId: string,
  session: SessionRecord,
  pick: string[] | ((known: string[]) => string[]),
): Promise<SessionRecord> {
  if (session.sessionKind !== 'chat' || session.rosterLocked) return session
  if (Array.isArray(pick) && pick.length === 0) return session
  const available =
    (await env.deps.listInvocableRegistryAgents?.(userId, 'chat', session.projectId)) ?? []
  const present = new Set(session.agents.map((member) => member.agentId))
  const known = available.filter((agent) => !present.has(agent.agentId)).map((agent) => agent.name)
  const newcomers = Array.isArray(pick)
    ? pick.filter((handle) => known.includes(handle))
    : pick(known)
  if (newcomers.length === 0) return session
  const change = await updateConversationMembership(env, {
    userId,
    sessionId: session.id,
    invite: newcomers,
  })
  return change.session
}
