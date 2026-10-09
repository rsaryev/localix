import {
  CONVERSATION_TURN_CONTROL,
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
 * agent invites a colleague or the user removes one, mid-conversation. Each
 * invite rewrote the cached prefix for every participant. So the RULES (which change only when
 * the conversation goes from one agent to several, or leadership moves) stay in the prefix, and
 * the ROSTER rides the volatile tail.
 *
 * `multi` is the membership snapshot the run STARTED with — the same snapshot that decides
 * whether the turn must end with `conversation_control` (`requiresConversationControl`), so
 * the prompt and the host's check can never disagree about which protocol this turn is under.
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

/** `# Conversation turn control` — the protocol, for a run that holds `conversation_control`. */
export function buildTurnControlSection(input: {
  multi: boolean
  isLeader?: boolean
  canChangeTopic?: boolean
}): string {
  const topic = input.canChangeTopic ? [TOPIC_CONTROL] : []
  if (!input.multi) return ['# Conversation turn control', SOLO_TURN_CONTROL, ...topic].join('\n')
  return [
    '# Conversation turn control',
    CONVERSATION_TURN_CONTROL,
    ...topic,
    'Only the user can remove participants. Keep colleagues in the conversation after their work is done.',
    TEAM_CONVERSATION,
    'Keep conversation_control and queue mechanics out of the public reply.',
    ...(input.isLeader
      ? ['## Leadership', TEAM_LEADERSHIP]
      : [
          'The conversation leader owns coordination and synthesis: do your assigned part and report concrete results.',
        ]),
    "Keep private state in your own lane, but shared workspace files are visible to everyone; never read a colleague's unpublished notes or files.",
    'Write the question or result without self-signing or narrating the queue.',
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
    `You are @${input.self}. Other participants:`,
    ...others.map(
      (participant) =>
        `- @${participant.handle}${participant.description ? `: ${participant.description}` : ''}`,
    ),
  ].join('\n')
}
