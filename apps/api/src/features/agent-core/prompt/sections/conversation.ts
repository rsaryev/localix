import {
  CONVERSATION_TURN_CONTROL,
  HUMAN_ASK_CONTROL,
  HUMAN_BOARD_CONTROL,
  HUMAN_NO_ASK_CONTROL,
  LEADER_BOARD,
  MEMBER_BOARD,
  MEMBER_BOARD_SKIP,
  MEMBER_SKIP,
  SKIP_ANSWER_CONTROL,
  SOLO_BOARD,
  SOLO_TURN_CONTROL,
  TEAM_CONVERSATION,
  TEAM_LEADERSHIP,
  TEAM_MEMBER,
  TOPIC_CONTROL,
} from './team-contract'
import { HUMAN_HANDLE, HUMAN_PROFILE_MAX_CHARS } from '@localixai/agent/agents'
import type { BuildAgentSystemPromptParams } from '../contracts'

export interface ConversationParticipant {
  handle: string
  description?: string
}

/** The person's record as the prompt reads it: who they are, never instructions to follow. */
export interface HumanProfile {
  label?: string
  description: string
  instructions: string
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
  /** A tag can bring an agent in: an open chat, not a delegated child or a job. */
  canInvite?: boolean
  /** The run holds a task board tool; board rules render only then. */
  hasBoard?: boolean
  /** The run holds `ask`. */
  canAsk?: boolean
}): string {
  const topic = input.canChangeTopic ? [TOPIC_CONTROL] : []
  const board = (line: string) => (input.hasBoard ? [line] : [])
  const human = [
    input.canAsk ? HUMAN_ASK_CONTROL : HUMAN_NO_ASK_CONTROL,
    ...board(HUMAN_BOARD_CONTROL),
  ]
  if (!input.multi) {
    return [
      '# Conversation turn control',
      ...(input.canInvite ? [SOLO_TURN_CONTROL] : []),
      ...human,
      ...board(SOLO_BOARD),
      ...topic,
    ].join('\n')
  }
  return [
    '# Conversation turn control',
    CONVERSATION_TURN_CONTROL,
    ...human,
    ...(input.canSkip ? [SKIP_ANSWER_CONTROL] : []),
    ...topic,
    'Only the user removes participants; keep colleagues after their work is done.',
    TEAM_CONVERSATION,
    ...(input.isLeader
      ? ['## Leadership', TEAM_LEADERSHIP, ...board(LEADER_BOARD)]
      : [
          '## Your part',
          TEAM_MEMBER,
          ...(input.canSkip ? [MEMBER_SKIP] : []),
          ...board(MEMBER_BOARD),
          ...(input.canSkip ? board(MEMBER_BOARD_SKIP) : []),
        ]),
    'Workspace files are shared with everyone; never read a colleague’s private scratch files.',
    'Do not sign your messages or narrate who speaks next.',
  ].join('\n')
}

/** One line per field: a profile is data in a list, not a block of prose. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The `@human` entry, bounded like the record itself. */
function humanEntry(human: HumanProfile | undefined): string[] {
  const label = oneLine(human?.label ?? '') || 'Human'
  const description = oneLine(human?.description ?? '').slice(0, HUMAN_PROFILE_MAX_CHARS)
  const instructions = oneLine(human?.instructions ?? '').slice(
    0,
    Math.max(0, HUMAN_PROFILE_MAX_CHARS - description.length),
  )
  return [
    `- @${HUMAN_HANDLE} (${label}): the person you work with${description ? ` — ${description}` : ''}`,
    ...(instructions ? [`  About them, in their words: ${instructions}`] : []),
  ]
}

/**
 * `# Conversation participants` — who is here, from the speaker's point of view.
 *
 * The person is always listed, alone or not, as data: their record says who they are and what to
 * ask them for. They are never addressed with a mention — questions go through `ask`. It rides here, in the volatile tail, so editing it never
 * rewrites the cached prefix.
 */
export function buildParticipantsSection(input: {
  self: string
  participants: readonly ConversationParticipant[]
  human?: HumanProfile
  /** The elected leader's handle; marked only once the conversation has colleagues. */
  leader?: string
}): string {
  const others = input.participants.filter((participant) => participant.handle !== input.self)
  const leader = others.length ? input.leader : undefined
  return [
    '# Conversation participants',
    `You are ${input.self}. Other participants (agents are addressed with @):`,
    ...humanEntry(input.human),
    ...others.map(
      (participant) =>
        `- @${participant.handle}${participant.handle === leader ? ' (leader)' : ''}${participant.description ? `: ${participant.description}` : ''}`,
    ),
    ...(!leader
      ? []
      : leader === input.self
        ? ['You are the leader.']
        : [
            `The leader is @${leader}: report to them, and send board or process problems to them.`,
          ]),
  ].join('\n')
}

/**
 * `# Agent directory` — who a tag can reach: an agent addressed in a reply joins and answers.
 * Every agent of an open chat reads it, whichever of them leads; it is the only listing of the
 * registry the model gets.
 */
export function buildAgentDirectorySection(
  agents: NonNullable<BuildAgentSystemPromptParams['agentDirectory']>,
): string {
  return [
    '# Agent directory',
    'Current registry. Tag an available agent with @handle to bring it into this conversation.',
    ...agents.map(
      (agent) =>
        `- @${agent.handle} (${
          agent.inConversation ? 'participant' : agent.available ? 'available' : 'unavailable'
        }, priority ${agent.leadershipPriority})${agent.description ? `: ${agent.description}` : ''}`,
    ),
  ].join('\n')
}
