import { DEFAULT_REASONING_EFFORT } from '@localixai/agent'
import type { SessionAgentRoute, SessionRecord } from '../../repository-types'
import { toSessionSummary } from '../../repository'
import { changeParticipants } from '../conversation-participants'
import type { RunEnv } from './types'

/**
 * What a membership change needs from its host. The run-state guards are optional ports: a
 * board-driven invitation removes nobody, so it has no speaker to protect and no turn to cancel.
 */
type MembershipEnv = {
  repo: RunEnv['repo']
  deps: Pick<RunEnv['deps'], 'streamRegistry' | 'listInvocableRegistryAgents'>
  activeAgentId?: (sessionId: string) => string | undefined
  cancelAgentTurn?: (userId: string, sessionId: string, agentId: string) => Promise<void>
}

type AvailableAgent = {
  agentId: string
  name: string
  description: string
}

export const normalizeAgentReference = (value: string) => value.trim().replace(/^@/, '')

export function resolveConversationMember(
  members: readonly SessionAgentRoute[],
  reference: string,
): SessionAgentRoute | undefined {
  const key = normalizeAgentReference(reference)
  return members.find((member) => member.agentId === key || member.handle === key)
}

const formatRoster = (members: readonly SessionAgentRoute[]): string =>
  members.map((member) => `@${member.handle} (${member.agentId})`).join(', ')

const unavailable = (reference: string, available: string): Error =>
  new Error(`Agent ${JSON.stringify(reference)} is unavailable. Available: ${available || 'none'}.`)

export interface ConversationMembershipChange {
  session: SessionRecord
  invited: AvailableAgent[]
  removed: SessionAgentRoute[]
}

/**
 * Atomically update a chat roster and publish the persisted result.
 *
 * Conversation membership belongs to chat: every invitation — a tag in a reply or a message —
 * and every removal is validated and published the same way whoever asked.
 */
export async function updateConversationMembership(
  env: MembershipEnv,
  input: {
    userId: string
    sessionId: string
    invite?: readonly string[]
    remove?: readonly string[]
    validate?: (agents: readonly SessionAgentRoute[]) => void
  },
): Promise<ConversationMembershipChange> {
  let invited: AvailableAgent[] = []
  let removed: SessionAgentRoute[] = []
  // The same writer the composer uses: it refuses removing the participant that is speaking,
  // cancels a leaver's queued turns and announces who came and went.
  const change = await changeParticipants(
    {
      repo: env.repo,
      streamRegistry: env.deps.streamRegistry,
      now: () => new Date().toISOString(),
      publishSession: (session) =>
        env.deps.streamRegistry.publish(input.userId, session.id, {
          type: 'session.updated',
          session: toSessionSummary(session),
        }),
      ...(env.activeAgentId ? { activeAgentId: env.activeAgentId } : {}),
      ...(env.cancelAgentTurn ? { cancelAgentTurn: env.cancelAgentTurn } : {}),
    },
    {
      userId: input.userId,
      sessionId: input.sessionId,
      decide: async (current) => {
        const decided = await decideMembership(env, current, input)
        invited = decided.invited
        removed = decided.removed
        return decided.agents
      },
    },
  )
  return { session: change.after, invited, removed }
}

/** The new roster for an invite/remove request, validated against the registry and the caller. */
async function decideMembership(
  env: MembershipEnv,
  current: SessionRecord,
  input: {
    invite?: readonly string[]
    remove?: readonly string[]
    validate?: (agents: readonly SessionAgentRoute[]) => void
    userId: string
  },
): Promise<{
  agents: SessionAgentRoute[]
  invited: AvailableAgent[]
  removed: SessionAgentRoute[]
}> {
  if (current.sessionKind !== 'chat') {
    throw new Error('Conversation membership is available only in chat sessions')
  }

  const available =
    (await env.deps.listInvocableRegistryAgents?.(input.userId, 'chat', current.projectId)) ?? []
  const availableByRef = new Map<string, AvailableAgent>()
  for (const agent of available) {
    availableByRef.set(agent.agentId, agent)
    availableByRef.set(agent.name, agent)
  }

  const removeIds = new Set<string>()
  for (const reference of input.remove ?? []) {
    const member = resolveConversationMember(current.agents, reference)
    if (!member) throw unavailable(reference, formatRoster(current.agents))
    removeIds.add(member.agentId)
  }

  const invited: AvailableAgent[] = []
  for (const reference of input.invite ?? []) {
    const key = normalizeAgentReference(reference)
    const existing = resolveConversationMember(current.agents, key)
    if (existing) {
      if (removeIds.has(existing.agentId)) {
        throw new Error(`Cannot invite and remove @${existing.handle} in the same call.`)
      }
      continue
    }
    const agent = availableByRef.get(key)
    if (!agent) {
      throw unavailable(
        reference,
        available.map((entry) => `@${entry.name} (${entry.agentId})`).join(', '),
      )
    }
    if (!invited.some((entry) => entry.agentId === agent.agentId)) invited.push(agent)
  }

  const removed = current.agents.filter((member) => removeIds.has(member.agentId))
  const agents: SessionAgentRoute[] = [
    ...current.agents.filter((member) => !removeIds.has(member.agentId)),
    ...invited.map((agent) => ({
      agentId: agent.agentId,
      handle: agent.name,
      // Undecided: the seat's whole route — model AND effort — is decided once on first read
      // (`session-route-defaults.ts`), never copied from another participant.
      providerConnectionId: null,
      modelId: '',
      reasoningEffort: DEFAULT_REASONING_EFFORT,
    })),
  ]
  if (agents.length === 0) throw new Error('A conversation must keep at least one participant.')
  input.validate?.(agents)
  return { agents, invited, removed }
}
