import {
  CONVERSATION_TURN_CONTROL,
  SKIP_ANSWER_CONTROL,
  SOLO_TURN_CONTROL,
  TEAM_CONVERSATION,
  TEAM_LEADERSHIP,
  TOPIC_CONTROL,
} from './system-prompt-team-contract'

export interface ConversationParticipant {
  handle: string
  description?: string
}

/**
 * The conversation in two sections, split by how often each changes.
 *
 * They used to be one section in the cached prefix, and the roster in it changes every time an
 * agent is tagged in or the user removes one, mid-conversation. Each change rewrote the cached
 * prefix for every participant. So the RULES (which change only when the conversation goes from
 * one agent to several, or leadership moves) stay in the prefix, and the ROSTER rides the volatile
 * tail.
 *
 * `multi` is the membership snapshot the run STARTED with; the host routes the reply against the
 * roster at its end, so a colleague tagged in mid-turn takes part from the next turn.
 */

/** Does the run's conversation hold anyone besides the speaker? */
export function isMultiAgentConversation(
  conversation: { self: string; participants: readonly ConversationParticipant[] } | undefined,
): boolean {
  return (
    conversation?.participants.some((participant) => participant.handle !== conversation.self) ??
    false
  )
}

/** `# Conversation turn control` — how a turn in this conversation hands the floor on. */
export function buildTurnControlSection(input: {
  multi: boolean
  isLeader?: boolean
  canChangeTopic?: boolean
  /** The run holds `skip_answer`. */
  canSkip?: boolean
  /** A tag can bring an agent in: an open chat, not a fixed roster or a delegated team. */
  canInvite?: boolean
}): string | null {
  const topic = input.canChangeTopic ? [TOPIC_CONTROL] : []
  if (!input.multi) {
    const solo = input.canInvite ? [SOLO_TURN_CONTROL] : []
    return solo.length || topic.length
      ? ['# Conversation turn control', ...solo, ...topic].join('\n')
      : null
  }
  return [
    '# Conversation turn control',
    CONVERSATION_TURN_CONTROL,
    ...(input.canSkip ? [SKIP_ANSWER_CONTROL] : []),
    ...topic,
    'Only the user removes participants; keep colleagues after their work is done.',
    TEAM_CONVERSATION,
    ...(input.isLeader
      ? ['## Leadership', TEAM_LEADERSHIP]
      : [
          'The conversation leader owns coordination and the final answer to the user: do your assigned part and report concrete results.',
        ]),
    'Workspace files are shared with everyone; never read a colleague’s private scratch files.',
    'Do not sign your messages or narrate who speaks next.',
  ].join('\n')
}

/** `# Conversation participants` — who else is here, from the speaker's point of view. */
export function buildParticipantsSection(input: {
  self: string
  participants: readonly ConversationParticipant[]
}): string | null {
  const others = input.participants.filter((participant) => participant.handle !== input.self)
  if (others.length === 0) return null
  return [
    '# Conversation participants',
    `You are ${input.self}. Other participants, addressed with @:`,
    ...others.map(
      (participant) =>
        `- @${participant.handle}${participant.description ? `: ${participant.description}` : ''}`,
    ),
  ].join('\n')
}
