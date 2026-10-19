/**
 * SEAT — where the speaker sits in the conversation: alone, leading it, or a member.
 *
 * The leader is elected, never configured on the conversation: the highest leadership priority
 * among the participants' own agent definitions wins, and party order breaks a tie. The seat
 * decides who owns the session topic and which half of the team contract a speaker reads.
 */
import { defineAxis, type AxisVariant } from '../axis'
import type { ConversationDecision } from './conversation'

export interface SeatMember {
  agentId: string
  handle: string
}

export interface SeatFacts {
  conversation: ConversationDecision
  agents: readonly SeatMember[]
  speakerAgentId: string
  /** Leadership priority by agent id, from the agents' own definitions. */
  priorities: ReadonlyMap<string, number>
}

export type SeatRole = 'solo' | 'leader' | 'member'

export interface SeatDecision {
  role: SeatRole
  /** The elected leader; absent only for a conversation with nobody in it. */
  leader?: SeatMember
  /** May set the shared session objective (`set_topic`): a chat's leader or lone agent. */
  ownsTopic: boolean
}

/** Highest priority wins; party order is the stable tie-break and remains presentation order. */
export function conversationLeader<Member extends SeatMember>(
  session: { agents: readonly Member[] },
  priorities: ReadonlyMap<string, number>,
): Member | undefined {
  const rank = (member: Member) => priorities.get(member.agentId) ?? 0
  return session.agents.reduce<Member | undefined>(
    (leader, member) => (!leader || rank(member) > rank(leader) ? member : leader),
    undefined,
  )
}

function decide(role: SeatRole) {
  return (facts: SeatFacts): SeatDecision => {
    const leader = conversationLeader(facts, facts.priorities)
    return {
      role,
      ...(leader ? { leader: { agentId: leader.agentId, handle: leader.handle } } : {}),
      ownsTopic: facts.conversation.kind !== 'isolated' && leader?.agentId === facts.speakerAgentId,
    }
  }
}

const seat = (
  role: SeatRole,
  applies: (facts: SeatFacts) => boolean,
): AxisVariant<SeatFacts, SeatDecision> => ({ id: role, applies, decide: decide(role) })

export const seatAxis = defineAxis<SeatFacts, SeatDecision>('seat', [
  seat('solo', (facts) => facts.agents.length <= 1),
  seat(
    'leader',
    (facts) => conversationLeader(facts, facts.priorities)?.agentId === facts.speakerAgentId,
  ),
  seat('member', () => true),
])

/**
 * The seat as a plugin tool sees it (`ToolSpeaker`): its role, and for a member the leader's
 * handle, so a refusal can name who to ask instead of "the leader".
 */
export function speakerPlace(seat: SeatDecision): { role: SeatRole; leader?: string } {
  return seat.role === 'member' && seat.leader
    ? { role: 'member', leader: seat.leader.handle }
    : { role: seat.role }
}
