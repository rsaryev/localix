/**
 * CONVERSATION — what surrounds the agent: a chat with the person, or nothing.
 *
 * A conversation has exactly one agent, fixed when it is created, so there is no roster to
 * route, invite into or pass within. What is left to decide is whether the session is the
 * person's own chat or an isolated one (a delegated child, a job), and whether a delegated
 * child's report may join a running turn here. It is a pure function of the session record, so
 * the server's dispatch, the run stages and the browser all read the same decision.
 */
import { defineAxis, type AxisVariant } from '../axis'

export interface ConversationFacts {
  sessionKind: string
}

export type ConversationKind = 'isolated' | 'chat'

export interface ConversationDecision {
  kind: ConversationKind
  /** A delegated child's report may join a running turn here; `null` when it never does. */
  childReports: boolean
}

const conversation = (
  kind: ConversationKind,
  applies: (facts: ConversationFacts) => boolean,
  childReports: ConversationDecision['childReports'],
): AxisVariant<ConversationFacts, ConversationDecision> => ({
  id: kind,
  applies,
  decide: () => ({ kind, childReports }),
})

export const conversationAxis = defineAxis<ConversationFacts, ConversationDecision>(
  'conversation',
  [
    conversation('isolated', (facts) => facts.sessionKind !== 'chat', false),
    conversation('chat', () => true, true),
  ],
)
