/**
 * The conversation half of a run's system prompt: who else is in this conversation.
 *
 * A one-function module because the question it answers is one line of the prompt builder's call
 * and none of its business otherwise — the builder composes sections, it does not know what a
 * session's participants are. Here they become a roster and election context, including a solo chat.
 */
import { agentRoute } from '../../session-route'
import { conversationLeader } from '../conversation-strategy'
import type { SessionRecord } from '../../repository'
import type { HumanProfile } from '../../../agent-core/system-prompt-conversation-section'

export interface ConversationPromptContext {
  self: string
  participants: readonly { handle: string }[]
  /** The person, always listed beside the agents (`@human`). */
  human?: HumanProfile
  isLeader: boolean
  /** The elected leader's handle (no `@`); the roster marks it, so every agent knows whom to report to. */
  leader?: string
  /** Nobody here can be invited or removed: it is not a chat. */
  membershipClosed: boolean
}

/**
 * The roster and election from the speaker's point of view, including a solo chat.
 *
 * `self` is the run's current participant, selected by the execution contract.
 */
export function conversationPromptContext(
  session: SessionRecord,
  speakerAgentId: string,
  /** From the registry roster the run already read — the same rank dispatch elects by. */
  priorities: ReadonlyMap<string, number>,
  human?: HumanProfile,
): ConversationPromptContext | undefined {
  const speaker = agentRoute(session, speakerAgentId)
  if (!speaker) return undefined
  const leader = conversationLeader(session, priorities)
  return {
    self: speaker.handle,
    participants: (session.agents ?? []).map((participant) => ({ handle: participant.handle })),
    ...(human ? { human } : {}),
    isLeader: leader?.agentId === speaker.agentId,
    ...(leader ? { leader: leader.handle } : {}),
    membershipClosed: session.sessionKind !== 'chat',
  }
}
