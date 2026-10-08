import { ALL_MENTION_HANDLE } from '@localixai/agent/agents'
import { mentionedHandles } from '../agent-mentions'
import { isMultiParticipant } from '../session-route'
import { participantAgentId } from '../../../db/participant'
import type { PersistedMessage } from '../contracts'
import type { SessionRecord } from '../repository'

export type AgentTurnSource =
  | 'user-address'
  | 'user-default'
  | 'user-broadcast'
  | 'agent-request'
  | 'runtime'

export interface ConversationRecipient {
  agentId: string
  source: AgentTurnSource
}

/**
 * Each participant's leadership priority, keyed by agent id, read from the AGENT'S OWN definition.
 *
 * The participant row used to carry a copy. It went stale whenever the agent was edited, and
 * keeping it fresh made the agents feature write this feature's table — the dependency that
 * closed the agents ↔ chat cycle. The definition is the only owner now. Lazy, because only the
 * first unaddressed turn of a multi-participant conversation elects a leader.
 */
export type LeadershipPriorities = () => Promise<ReadonlyMap<string, number>>

/** The registry roster both hosts already hold; a failed read degrades to party order. */
export type LeadershipRoster = (
  userId: string,
  projectId: string | null,
) => Promise<readonly { agentId: string; leadershipPriority?: number }[]>

export function rosterLeadership(
  roster: LeadershipRoster | undefined,
  userId: string,
  projectId: string | null,
): LeadershipPriorities {
  return async () =>
    new Map(
      (roster ? await roster(userId, projectId) : []).map((agent) => [
        agent.agentId,
        agent.leadershipPriority ?? 0,
      ]),
    )
}

/** Nobody leads by rank: party order decides. For a host with no registry. */
export const noLeadership: LeadershipPriorities = async () => new Map()

export interface ConversationContext {
  session: Pick<SessionRecord, 'agents'>
  history: readonly PersistedMessage[]
  priorities: LeadershipPriorities
}

export type ConversationEvent =
  | { kind: 'user-message'; text: string }
  | { kind: 'runtime'; recipient?: string }
  | {
      kind: 'agent-request'
      from: string
      recipients: readonly string[]
      /** Host-only: a saved topic change may continue in a fresh run by the same participant. */
      allowSelf?: boolean
    }

/** Pure policy: returns execution intents. It never stores or executes pending work. */
export interface ConversationStrategy {
  readonly id: string
  accepts(context: ConversationContext): boolean
  recipients(
    context: ConversationContext,
    event: ConversationEvent,
  ): Promise<ConversationRecipient[]>
}

function explicitRecipients(
  context: ConversationContext,
  event: Exclude<ConversationEvent, { kind: 'user-message' }>,
): ConversationRecipient[] {
  const members = context.session.agents
  if (event.kind === 'runtime') {
    const target = event.recipient === undefined ? leastRecent(context) : event.recipient
    return members.some((member) => member.agentId === target)
      ? [{ agentId: target!, source: 'runtime' }]
      : []
  }
  const requested = new Set(event.recipients)
  if (
    [...requested].some(
      (handle) =>
        !members.some(
          (member) =>
            member.handle === handle && (event.allowSelf || member.agentId !== event.from),
        ),
    )
  ) {
    throw new Error('Handoff recipients must be current colleagues, excluding yourself')
  }
  return members
    .filter((member) => requested.has(member.handle))
    .map((member) => ({ agentId: member.agentId, source: 'agent-request' }))
}

function leastRecent({ session, history }: ConversationContext): string | undefined {
  const dispatched = new Map<string, number>()
  history.forEach((message, index) => {
    if (message.payload.role !== 'assistant') return
    const author = participantAgentId(message.payload.from)
    if (author) dispatched.set(author, index)
  })
  return [...session.agents].sort(
    (a, b) => (dispatched.get(a.agentId) ?? -1) - (dispatched.get(b.agentId) ?? -1),
  )[0]?.agentId
}

/** Highest priority wins; party order is the stable tie-break and remains presentation order. */
export function conversationLeader(
  session: Pick<SessionRecord, 'agents'>,
  priorities: ReadonlyMap<string, number>,
): SessionRecord['agents'][number] | undefined {
  const rank = (member: SessionRecord['agents'][number]) => priorities.get(member.agentId) ?? 0
  return session.agents.reduce<SessionRecord['agents'][number] | undefined>(
    (leader, member) => (!leader || rank(member) > rank(leader) ? member : leader),
    undefined,
  )
}

function hasParticipantAnswer(history: readonly PersistedMessage[]): boolean {
  return history.some(
    (message) =>
      message.payload.role === 'assistant' &&
      message.payload.to === 'user' &&
      participantAgentId(message.payload.from) !== null &&
      (Boolean(message.payload.content?.trim()) || Boolean(message.payload.items?.length)),
  )
}

export const directConversationStrategy: ConversationStrategy = {
  id: 'direct',
  accepts: ({ session }) => !isMultiParticipant(session),
  async recipients(context, event) {
    if (event.kind !== 'user-message') return explicitRecipients(context, event)
    const member = context.session.agents[0]
    return member ? [{ agentId: member.agentId, source: 'user-default' }] : []
  },
}

export const multiParticipantStrategy: ConversationStrategy = {
  id: 'multi-participant',
  accepts: ({ session }) => isMultiParticipant(session),
  async recipients(context, event) {
    if (event.kind !== 'user-message') return explicitRecipients(context, event)
    const { session, history } = context
    const named = mentionedHandles(event.text, [
      ...session.agents.map((member) => member.handle),
      ALL_MENTION_HANDLE,
    ])
    const direct = session.agents
      .filter((member) => named.includes(member.handle))
      .map((member): ConversationRecipient => ({ agentId: member.agentId, source: 'user-address' }))
    if (named.includes(ALL_MENTION_HANDLE))
      return [
        ...direct,
        ...session.agents
          .filter((member) => !direct.some((entry) => entry.agentId === member.agentId))
          .map(
            (member): ConversationRecipient => ({
              agentId: member.agentId,
              source: 'user-broadcast',
            }),
          ),
      ]
    if (direct.length) return direct
    // The first unaddressed turn establishes the room through its elected leader. Deriving this
    // from durable transcript history survives restarts and branching without a second state bit.
    if (!hasParticipantAnswer(history)) {
      const leader = conversationLeader(session, await context.priorities())
      return leader ? [{ agentId: leader.agentId, source: 'user-default' }] : []
    }
    const last = history.at(-1)?.payload
    const answering =
      last?.role === 'assistant' && last.to === 'user' ? participantAgentId(last.from) : null
    const target =
      answering && session.agents.some((member) => member.agentId === answering)
        ? answering
        : leastRecent(context)
    return target ? [{ agentId: target, source: 'user-default' }] : []
  },
}

/** First matching registered policy wins. Hosts can inject alternatives without changing dispatch. */
export function createConversationStrategyResolver(strategies: readonly ConversationStrategy[]) {
  return (context: ConversationContext): ConversationStrategy => {
    const strategy = strategies.find((candidate) => candidate.accepts(context))
    if (!strategy) throw new Error('No conversation strategy accepts these participants')
    return strategy
  }
}

export const resolveConversationStrategy = createConversationStrategyResolver([
  directConversationStrategy,
  multiParticipantStrategy,
])
