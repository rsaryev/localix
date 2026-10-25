/**
 * The conversation half of a run's system prompt: who else is in this conversation, and who a tag
 * could bring in.
 *
 * Its own module because each question it answers is one line of the prompt builder's call and
 * none of its business otherwise — the builder composes sections, it does not know what a
 * session's participants are. Here they become a roster and election context, including a solo
 * chat, and the agent directory.
 */
import { agentRoute } from '../../../../contracts/session-route'
import type { RunPolicy } from '../../policy/run-policy'
import type { SessionRecord } from '../../repository'

export interface ConversationPromptContext {
  self: string
  participants: readonly { handle: string }[]
  isLeader: boolean
  /** The elected leader's handle (no `@`); the roster marks it, so every agent knows whom to report to. */
  leader?: string
  /** A tag cannot bring anybody in (`policy.conversation.tagInvites`). */
  membershipClosed: boolean
  /** No conversation surrounds the run (`policy.conversation.kind === 'isolated'`). */
  isolated?: true
}

/**
 * The roster and election from the speaker's point of view, including a solo chat.
 *
 * `self` is the run's current participant, selected by the execution contract; the leader is
 * the one its policy elected (`policy/axes/seat.ts`), from the registry the run read once.
 */
export function conversationPromptContext(
  session: SessionRecord,
  speakerAgentId: string,
  policy: Pick<RunPolicy, 'seat' | 'conversation'>,
): ConversationPromptContext | undefined {
  const speaker = agentRoute(session, speakerAgentId)
  if (!speaker) return undefined
  const { leader } = policy.seat
  return {
    self: speaker.handle,
    participants: (session.agents ?? []).map((participant) => ({ handle: participant.handle })),
    isLeader: leader?.agentId === speaker.agentId,
    ...(leader ? { leader: leader.handle } : {}),
    membershipClosed: !policy.conversation.tagInvites,
    ...(policy.conversation.kind === 'isolated' ? { isolated: true as const } : {}),
  }
}

/** One registered agent, as the prompt's directory lists it. */
export interface AgentDirectoryEntry {
  agentId: string
  name: string
  description: string
  leadershipPriority?: number
  enabled: boolean
  canJoinConversation: boolean
  /** `delegate` can hand it a task. */
  delegable?: boolean
  tools?: readonly string[]
  self?: boolean
}

/**
 * The directory of agents an @mention could bring in, with the conversation's own members marked,
 * and the agents `delegate` can hand a task to. Where a tag reaches no one it lists only the
 * delegable ones, and nothing when the run cannot delegate either
 * (`policy.conversation.showsDirectory`); a member no longer in the registry is still listed,
 * unranked.
 */
export function agentDirectoryRows(
  session: SessionRecord,
  policy: RunPolicy,
  directory: readonly AgentDirectoryEntry[] | undefined,
  opts: { canDelegate: boolean } = { canDelegate: false },
) {
  const tags = policy.conversation.showsDirectory
  if (!tags && !opts.canDelegate) return undefined
  const available = new Map((directory ?? []).map((agent) => [agent.agentId, agent]))
  const rows = [...(directory ?? [])]
    .filter((agent) => tags || agent.delegable)
    .map((agent) => ({
      id: agent.agentId,
      handle: agent.name,
      description: agent.description,
      leadershipPriority: agent.leadershipPriority ?? 0,
      inConversation: session.agents.some((member) => member.agentId === agent.agentId),
      available: tags && agent.enabled && agent.canJoinConversation,
      ...(agent.delegable ? { delegable: true } : {}),
      ...(agent.tools ? { tools: agent.tools } : {}),
      ...(agent.self ? { self: true } : {}),
    }))
  for (const member of tags ? session.agents : []) {
    if (available.has(member.agentId)) continue
    rows.push({
      id: member.agentId,
      handle: member.handle,
      description: '',
      // Not in the registry any more, so no definition ranks it — the same 0 dispatch uses.
      leadershipPriority: 0,
      inConversation: true,
      available: true,
    })
  }
  return rows
}
