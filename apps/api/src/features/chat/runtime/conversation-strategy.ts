import { ALL_MENTION_HANDLE } from '@localixai/agent/agents'
import { addressedHandles } from '../conversation-addressing'
import { participantAgentId } from '../../../db/participant'
import { conversationLeader } from '../policy/axes/seat'
import { conversationPolicy } from '../policy/session-policy'
import type { PersistedMessage } from '../contracts'
import type { SessionRecord } from '../repository'
import type { FloorAdvisor } from './floor-advice'

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
  session: Pick<SessionRecord, 'agents' | 'sessionKind'>
  history: readonly PersistedMessage[]
  priorities: LeadershipPriorities
  /** A decision model's pick for a message the grammar finds unaddressed (`floor-advice.ts`). */
  advisor?: FloorAdvisor
}

export type ConversationEvent =
  | { kind: 'user-message'; text: string }
  | { kind: 'runtime'; recipient?: string }
  | { kind: 'agent-request'; from: string; recipients: readonly string[] }

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
  // In the order the reply addressed them: the author decides who goes first.
  const recipients: ConversationRecipient[] = []
  for (const handle of new Set(event.recipients)) {
    const member = members.find((entry) => entry.handle === handle && entry.agentId !== event.from)
    if (!member)
      throw new Error('Handoff recipients must be current colleagues, excluding yourself')
    recipients.push({ agentId: member.agentId, source: 'agent-request' })
  }
  return recipients
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

export const directConversationStrategy: ConversationStrategy = {
  id: 'direct',
  accepts: ({ session }) => conversationPolicy(session).routing === 'direct',
  async recipients(context, event) {
    if (event.kind !== 'user-message') return explicitRecipients(context, event)
    const member = context.session.agents[0]
    return member ? [{ agentId: member.agentId, source: 'user-default' }] : []
  },
}

export const multiParticipantStrategy: ConversationStrategy = {
  id: 'multi-participant',
  accepts: ({ session }) => conversationPolicy(session).routing === 'multi-participant',
  async recipients(context, event) {
    if (event.kind !== 'user-message') return explicitRecipients(context, event)
    const { session } = context
    // The same grammar a reply and an invitation are read by: a handle in code, a quote or a
    // link target is a reference, so `run \`@qa deploy\`` asks nobody to answer.
    const named = addressedHandles(event.text, [
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
          .map((member): ConversationRecipient => ({
            agentId: member.agentId,
            source: 'user-broadcast',
          })),
      ]
    if (direct.length) return direct
    // A message addressed to nobody belongs to the leader: only the leader hands work out —
    // unless a confident decision model names the one participant the message is for.
    const leader = conversationLeader(session, await context.priorities())
    const advised = await context.advisor?.({
      members: session.agents,
      history: context.history,
      ...(leader ? { leaderAgentId: leader.agentId } : {}),
      text: event.text,
    })
    const advisedMember = session.agents.find((member) => member.handle === advised)
    if (advisedMember) return [{ agentId: advisedMember.agentId, source: 'user-default' }]
    return leader ? [{ agentId: leader.agentId, source: 'user-default' }] : []
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
