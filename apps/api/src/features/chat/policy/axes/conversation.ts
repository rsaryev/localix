/**
 * CONVERSATION — who shares the session with the speaker, and how the room may change.
 *
 * Every multi-participant branch used to ask its own question: `agents.length > 1` for the
 * pass, `<= 1` for routing, `=== 1` for steering, `sessionKind === 'chat'` for invites and the
 * directory, and a handle comparison in the prompt. They agreed only by accident. This axis is
 * the one answer, and it is a pure function of the session record, so the server's dispatch,
 * the run stages and the browser all read the same decision (`@localixai/api/conversation-policy`).
 *
 * A non-chat session (a delegated child, a job) is `isolated`: it has one agent and a fixed
 * membership. A chat is `solo` when the person made it one (`conversation-modes.ts`): one agent,
 * no team protocol, nobody brought in by a tag. Every other chat is a `group`, open to whoever a
 * tag or the person brings in — with one participant it is a lone agent that may still bring
 * colleagues in, which is how every chat behaved before modes existed.
 */
import { chooseOn, defineAxis, type AxisVariant } from '../axis'
import type { ConversationMode } from '../../conversation-modes'

export interface ConversationFacts {
  sessionKind: string
  agents: readonly unknown[]
  /** Absent reads as a group: a record from before modes, or one built in memory. */
  conversationMode?: ConversationMode
}

export type ConversationKind = 'isolated' | 'solo' | 'group'

export interface ConversationDecision {
  kind: ConversationKind
  /** More than one agent shares the conversation right now. */
  withColleagues: boolean
  /** Who receives a message (`runtime/conversation-strategy.ts`). */
  routing: 'direct' | 'multi-participant'
  /** An @tag in the person's message or an agent's reply invites an available agent. */
  tagInvites: boolean
  /**
   * Who is in the conversation can change at all. A solo chat can: adding a participant is the
   * person's act, and it makes the conversation a group.
   */
  membershipEditable: boolean
  /** The prompt lists the registry: who a tag can reach. */
  showsDirectory: boolean
  /** A participant may pass with `skip_answer`. */
  canPass: boolean
  /** A turn that wrote nothing is a silent pass rather than an empty reply. */
  silentEmptyTurns: boolean
  /** A settled reply is routed to whoever it addresses. */
  routesReplies: boolean
  /** A delegated child's report may join a running turn here; `null` when it never does. */
  childReports: { allowUnaddressed: boolean } | null
}

const count = (facts: ConversationFacts) => facts.agents.length

const conversation = (
  kind: ConversationKind,
  applies: (facts: ConversationFacts) => boolean,
  decide: (
    facts: ConversationFacts,
    withColleagues: boolean,
  ) => Omit<ConversationDecision, 'kind' | 'withColleagues' | 'routing'>,
): AxisVariant<ConversationFacts, ConversationDecision> => ({
  id: kind,
  applies,
  decide: (facts) => {
    const withColleagues = count(facts) > 1
    return {
      kind,
      withColleagues,
      routing: withColleagues ? 'multi-participant' : 'direct',
      ...decide(facts, withColleagues),
    }
  },
})

export const conversationAxis = defineAxis<ConversationFacts, ConversationDecision>(
  'conversation',
  [
    conversation(
      'isolated',
      (facts) => facts.sessionKind !== 'chat',
      (_facts, withColleagues) => ({
        tagInvites: false,
        membershipEditable: false,
        showsDirectory: false,
        canPass: false,
        silentEmptyTurns: withColleagues,
        routesReplies: withColleagues,
        childReports: null,
      }),
    ),
    conversation(
      'solo',
      (facts) => facts.conversationMode === 'solo',
      () => ({
        tagInvites: false,
        membershipEditable: true,
        showsDirectory: false,
        canPass: false,
        silentEmptyTurns: false,
        routesReplies: false,
        childReports: { allowUnaddressed: true },
      }),
    ),
    conversation(
      'group',
      () => true,
      (facts, withColleagues) => ({
        tagInvites: true,
        membershipEditable: true,
        showsDirectory: true,
        canPass: withColleagues,
        silentEmptyTurns: withColleagues,
        routesReplies: true,
        childReports: { allowUnaddressed: count(facts) === 1 },
      }),
    ),
  ],
)

/**
 * The conversation decision for one session record — the browser's entry point
 * (`@localixai/api/conversation-policy`), so the composer and the server read one answer.
 */
export function conversationDecision(facts: ConversationFacts): ConversationDecision {
  return chooseOn(conversationAxis, facts).decision
}
