/**
 * PRODUCTION-SHAPED prompts: the seats a host actually builds.
 *
 * The shape goldens render a run with no conversation at all, which no host produces: every
 * run is dispatched for a participant, so every production prompt carries turn control and the
 * roster. These scenarios state what a host knows about a seat — who is in the room, who
 * speaks, who leads, whether membership can grow, which protocol ports the seat holds — and
 * render what that seat reads. They are committed beside the shape goldens, so a change to any
 * seat's prompt is reviewed as text.
 *
 * The facts are the host's own (`chat/runtime/run/system-prompt-conversation.ts`): participants
 * carry handles only, the leader is marked by handle, membership is closed for every session
 * that is not a chat, and the directory exists only where a tag can invite.
 */
import type { BuildAgentSystemPromptParams } from '../assemble'
import type { OptionalToolPorts } from '../../tool-registry'
import { fullPrompt, type PromptShapeKey } from './prompt-render'

interface Seat {
  shape: PromptShapeKey
  params: Partial<BuildAgentSystemPromptParams>
  /** Ports the host builds only for some seats (`skip_answer`, `set_topic`). */
  withoutPorts: readonly (keyof OptionalToolPorts)[]
}

const TOPIC = { title: 'Ship the release', goal: 'Release 1.4 is published' }

/** The registry beside a chat: the default agent, a QA colleague, and who sits where. */
function directory(present: readonly string[]): BuildAgentSystemPromptParams['agentDirectory'] {
  return [
    {
      id: 'agent-localix',
      handle: 'localix',
      description: 'General agent',
      leadershipPriority: 50,
    },
    { id: 'agent-qa', handle: 'qa', description: 'Verifies releases', leadershipPriority: 10 },
  ].map((row) => ({ ...row, inConversation: present.includes(row.handle), available: true }))
}

/** A chat with one agent: it leads, owns the topic, and has no colleague to pass to. */
const SOLO_CHAT: Seat = {
  shape: 'orchestrator',
  params: {
    conversation: {
      self: 'localix',
      participants: [{ handle: 'localix' }],
      isLeader: true,
      leader: 'localix',
      membershipClosed: false,
    },
    canChangeTopic: true,
    sessionTopic: TOPIC,
    agentDirectory: directory(['localix']),
  },
  withoutPorts: ['skip_answer'],
}

/** A session that is not a chat: one agent, nobody joins, no directory, no topic. */
function closedSeat(shape: PromptShapeKey): Seat {
  return {
    shape,
    params: {
      conversation: {
        self: 'localix',
        participants: [{ handle: 'localix' }],
        isLeader: true,
        leader: 'localix',
        membershipClosed: true,
      },
    },
    withoutPorts: ['skip_answer', 'set_topic'],
  }
}

const SEATS: Record<string, Seat> = {
  'seat-chat-solo': SOLO_CHAT,
  'seat-chat-group-leader': {
    shape: 'orchestrator',
    params: {
      conversation: {
        self: 'localix',
        participants: [{ handle: 'localix' }, { handle: 'qa' }],
        isLeader: true,
        leader: 'localix',
        membershipClosed: false,
      },
      canChangeTopic: true,
      sessionTopic: TOPIC,
      agentDirectory: directory(['localix', 'qa']),
    },
    withoutPorts: [],
  },
  'seat-chat-group-member': {
    shape: 'orchestrator',
    params: {
      conversation: {
        self: 'qa',
        participants: [{ handle: 'localix' }, { handle: 'qa' }],
        human: {
          label: 'Alex',
          description: 'Product owner',
          instructions: 'Prefers short answers',
        },
        isLeader: false,
        leader: 'localix',
        membershipClosed: false,
      },
      canChangeTopic: false,
      sessionTopic: TOPIC,
      agentDirectory: directory(['localix', 'qa']),
    },
    withoutPorts: ['set_topic'],
  },
  'seat-chat-solo-plan': {
    ...SOLO_CHAT,
    params: { ...SOLO_CHAT.params, planMode: { draftPath: '/repo/.localix/plans/s1/PLAN.md' } },
  },
  'seat-chat-solo-channel': {
    ...SOLO_CHAT,
    params: { ...SOLO_CHAT.params, deliveryContext: { channel: 'messenger' } },
  },
  'seat-subagent': closedSeat('subagent'),
  'seat-automation': closedSeat('automation'),
}

/** Every production seat, rendered: name → prompt. */
export function renderSeatMatrix(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(SEATS).map(([name, seat]) => [
      name,
      fullPrompt(seat.shape, seat.params, undefined, seat.withoutPorts),
    ]),
  )
}
