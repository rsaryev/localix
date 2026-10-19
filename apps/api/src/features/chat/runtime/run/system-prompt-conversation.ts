/**
 * The conversation half of a run's system prompt: who else is in this conversation.
 *
 * A one-function module because the question it answers is one line of the prompt builder's call
 * and none of its business otherwise — the builder composes sections, it does not know what a
 * session's participants are. Here they become a roster and election context, including a solo chat.
 */
import { agentRoute } from '../../session-route'
import type { RunPolicy } from '../../policy/run-policy'
import type { SessionRecord } from '../../repository'
import type { HumanProfile } from '../../../agent-core/prompt/sections/conversation'

export interface ConversationPromptContext {
  self: string
  participants: readonly { handle: string }[]
  /** The person, always listed beside the agents (`@human`). */
  human?: HumanProfile
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
  human?: HumanProfile,
): ConversationPromptContext | undefined {
  const speaker = agentRoute(session, speakerAgentId)
  if (!speaker) return undefined
  const { leader } = policy.seat
  return {
    self: speaker.handle,
    participants: (session.agents ?? []).map((participant) => ({ handle: participant.handle })),
    ...(human ? { human } : {}),
    isLeader: leader?.agentId === speaker.agentId,
    ...(leader ? { leader: leader.handle } : {}),
    membershipClosed: !policy.conversation.tagInvites,
    ...(policy.conversation.kind === 'isolated' ? { isolated: true as const } : {}),
  }
}
