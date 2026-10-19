/**
 * WHO SHOULD TAKE THE FLOOR NEXT — a decision model's advice where the grammar cannot tell.
 *
 * The addressing grammar (`conversation-addressing.ts`) is exact about what it can see: a person's
 * `@handle`, a reply's `@handle`. It is blind to the rest — "Lawyer, have a look" with no `@`, an
 * `@design` that only credits a colleague, a person's untagged message that plainly belongs to one
 * specialist. A decision model (Jev through OpenRouter, System One protocol) reads the transcript
 * window and answers one typed question: who speaks next — two more for a person's untagged one.
 *
 * The grammar stays the floor. The model's pick replaces it only when the model is confident
 * (`FLOOR_ADVICE_CONFIDENCE`); measured on 1814 labelled group turns, that hybrid answered 86%
 * right against 74% for the grammar alone and 80% for the model alone.
 *
 * A person's untagged message asks two more questions in the same pass, because "who of all of
 * them" hides two judgments — one participant's work or the leader's to coordinate, and whose —
 * and two close participants split the one answer below the bar even when the leader is plainly
 * wrong ("make the tiles the same size": frontend 0.58, design 0.41, leader 0.01). Asked apart,
 * "can one participant do it alone?" answers 0.85 and the pick only has to lead. The leader is
 * whoever the seat elected, a specialist included, so the questions name coordination — what a
 * leader is for — and the pick covers every participant, the leader too.
 *
 * Pure: the transcript window, the request and the reading of the answer. The call itself and
 * the route's settings live in `floor-advisor.ts`.
 */
import type { DecisionAnswer, DecisionRequest, DecisionResult } from '@localixai/agent/runtime'

import { participantAgentId } from '../../../db/participant'
import type { PersistedMessage } from '../contracts'

/** The option that hands the floor back to the person. */
export const FLOOR_PERSON = 'person'
/** Below this probability the grammar decides. */
export const FLOOR_ADVICE_CONFIDENCE = 0.8
/** "One participant alone?" at or above this hands an untagged message to the leading pick… */
export const FLOOR_ALONE_NEEDED = 0.6
/** …when that participant leads the pick with at least this probability. */
export const FLOOR_ALONE_PICK = 0.5
/** "One participant alone?" below this keeps the message with the leader to coordinate. */
export const FLOOR_ALONE_VETO = 0.4
/** Messages the model reads, the event's own included. */
export const FLOOR_WINDOW = 8
/** Characters kept of each message: its head (the result) and its tail (the handoff). */
export const FLOOR_MESSAGE_CHARS = 500

export interface FloorMember {
  agentId: string
  handle: string
  description?: string
}

export interface FloorQuestion {
  members: readonly FloorMember[]
  /** The rows before the event, oldest first. */
  history: readonly PersistedMessage[]
  /** The participant whose reply is the event; absent when the person wrote it. */
  authorAgentId?: string
  /** Who takes a person's untagged message without advice: the one who coordinates. */
  leaderAgentId?: string
  text: string
}

/** Whose route settings, ledger and agent directory one advisor reads. */
export interface FloorScope {
  userId: string
  sessionId: string
  projectId: string | null
}

/** A member's handle or {@link FLOOR_PERSON}; `null` when the model is not confident. */
export type FloorAdvisor = (question: FloorQuestion) => Promise<string | null>

/** What the answer said and why it was or was not followed — the decision's log record. */
export interface FloorReading {
  pick: string | null
  reason: 'confident' | 'alone' | 'coordinate' | 'similar' | 'unsure'
  next: Record<string, number>
  /** "Can one participant act on it alone?" — a person's untagged message only. */
  alone?: number
  which?: Record<string, number>
}

const clip = (text: string, max = FLOOR_MESSAGE_CHARS) =>
  text.length > max ? `${text.slice(0, max / 2)} … ${text.slice(-max / 2)}` : text

/** The visible conversation as `{ author, text }`, ending with the event. */
export function floorTranscript(question: FloorQuestion): { author: string; text: string }[] {
  const handles = new Map(question.members.map((member) => [member.agentId, member.handle]))
  const speaker = (agentId: string | undefined) =>
    agentId === undefined ? FLOOR_PERSON : `@${handles.get(agentId) ?? 'agent'}`
  const rows = question.history.flatMap((message) => {
    const { payload } = message
    const text = payload.content?.trim()
    if (!text || payload.isInternal || payload.uiOnly || payload.systemNotice) return []
    if (payload.role === 'user') return [{ author: FLOOR_PERSON, text: clip(text) }]
    return [{ author: speaker(participantAgentId(payload.from) ?? undefined), text: clip(text) }]
  })
  return [
    ...rows.slice(-(FLOOR_WINDOW - 1)),
    { author: speaker(question.authorAgentId), text: clip(question.text) },
  ]
}

/** An option's description: the agent's own, else its handle read as a specialist's name. */
export const describeMember = (member: FloorMember) =>
  member.description?.trim() || `The ${member.handle.replace(/[_-]/g, ' ')} specialist.`

/** One `choice` question over every option; after a person's untagged message, two more. */
export function floorDecisionRequest(question: FloorQuestion): Omit<DecisionRequest, 'signal'> {
  const author = question.members.find((member) => member.agentId === question.authorAgentId)
  const criteria = Object.fromEntries(
    question.members
      .filter((member) => member !== author)
      .map((member) => [member.handle, describeMember(member)]),
  )
  if (author)
    criteria[FLOOR_PERSON] =
      'The person who runs the chat: reads results, answers questions, gives the next task.'
  const leader = author
    ? undefined
    : question.members.find((member) => member.agentId === question.leaderAgentId)
  return {
    state: { transcript: floorTranscript(question) },
    questions: {
      next: {
        type: 'choice',
        instructions: author
          ? `@${author.handle} just wrote the last message of \`transcript\`. Who should take the floor next? A teammate when that message hands them work or their part comes next; the person when it answers the person, reports a finished result or asks the person something.`
          : 'The person just wrote the last message of `transcript`. Which participant should take the floor and act on it?',
        criteria,
      },
      ...(leader
        ? {
            alone: {
              type: 'bool' as const,
              instructions: `The person just wrote the last message of \`transcript\`. Can one participant act on it alone, without @${leader.handle} coordinating several of them?`,
              // The neighbouring case sits on the side it belongs to: work that spans several
              // participants is the leader's to split, however specialist each part sounds.
              criteria: {
                true: 'One participant’s own field covers all of it, as their description states: a fix, a check or a question for that one participant.',
                false: `It needs several participants (a whole feature, a site, a bot), asks who does what, is small talk or a general question, or nobody’s field covers it: @${leader.handle} takes it.`,
              },
            },
            which: {
              type: 'choice' as const,
              instructions:
                'If one participant can act on the last message of `transcript` alone, which one?',
              criteria,
            },
          }
        : {}),
    },
  }
}

const probabilityOf = (answer: DecisionAnswer | undefined, option: string) =>
  answer?.type === 'choice' ? (answer.probabilities[option] ?? 0) : 0

/**
 * Whether the answer names someone to follow. After a reply: the pick, when confident. After a
 * person's untagged message: a clear "needs coordinating" keeps it with the leader; otherwise a
 * confident pick, or else the leading pick when one participant can plainly do it alone.
 */
export function readFloor(
  result: DecisionResult,
  request: Omit<DecisionRequest, 'signal'>,
): FloorReading {
  const next = result.answers.next
  const options = request.questions.next!.criteria
  const reading = { next: next?.type === 'choice' ? next.probabilities : {} }
  const aloneAnswer = result.answers.alone
  const which = result.answers.which
  const alone = aloneAnswer?.type === 'bool' ? aloneAnswer.probability : undefined
  const split = {
    ...(alone !== undefined ? { alone } : {}),
    ...(which?.type === 'choice' ? { which: which.probabilities } : {}),
  }
  if (alone !== undefined && alone < FLOOR_ALONE_VETO)
    return { pick: null, reason: 'coordinate', ...reading, ...split }
  if (
    next?.type === 'choice' &&
    next.choice in options &&
    probabilityOf(next, next.choice) >= FLOOR_ADVICE_CONFIDENCE
  )
    return { pick: next.choice, reason: 'confident', ...reading, ...split }
  if (
    alone !== undefined &&
    alone >= FLOOR_ALONE_NEEDED &&
    which?.type === 'choice' &&
    which.choice in options &&
    probabilityOf(which, which.choice) >= FLOOR_ALONE_PICK
  )
    return { pick: which.choice, reason: 'alone', ...reading, ...split }
  return { pick: null, reason: 'unsure', ...reading, ...split }
}

/**
 * A settled reply's handoff plan with the advice applied. A report back to whoever assigned the
 * turn always stands — finished work reaches the one who gave it — and is the reply's one way on:
 * the advice never forks it into a second colleague's turn. Otherwise:
 *   - advice `person`: the reply's `@`s were references, so it assigns nobody;
 *   - advice naming a colleague the plan already reaches: the grammar's plan stands;
 *   - advice naming another colleague: that colleague is the one asked to act.
 */
export function adviseHandoff(
  plan: { reports: string[]; assignments: string[] },
  advice: string | null,
): { reports: string[]; assignments: string[] } {
  if (advice === null) return plan
  if (advice === FLOOR_PERSON) return { reports: plan.reports, assignments: [] }
  if (plan.reports.includes(advice) || plan.assignments.includes(advice)) return plan
  if (plan.reports.length > 0 && plan.assignments.length === 0) return plan
  return { reports: plan.reports, assignments: [advice] }
}
