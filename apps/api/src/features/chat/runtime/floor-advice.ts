/**
 * WHO SHOULD TAKE THE FLOOR NEXT — a decision model's advice where the grammar cannot tell.
 *
 * The addressing grammar (`conversation-addressing.ts`) is exact about what it can see: a person's
 * `@handle`, a reply's `@handle`. It is blind to the rest — "Lawyer, have a look" with no `@`, an
 * `@design` that only credits a colleague, a person's untagged message that plainly belongs to one
 * specialist. A decision model (`groupRouting` route, OpenRouter's System One protocol) reads the
 * transcript window and answers one typed question: who speaks next.
 *
 * The grammar stays the floor. The model's pick replaces it only when the model is confident
 * (`FLOOR_ADVICE_CONFIDENCE`); measured on 1814 labelled group turns, that hybrid answered 86%
 * right against 74% for the grammar alone and 80% for the model alone.
 *
 * Pure: the transcript window, the request and the reading of the answer. The call itself and
 * the route's settings live in `floor-advisor.ts`.
 */
import type { DecisionRequest, DecisionResult } from '@localixai/agent/runtime'

import { participantAgentId } from '../../../db/participant'
import type { PersistedMessage } from '../contracts'

/** The option that hands the floor back to the person. */
export const FLOOR_PERSON = 'person'
/** Below this probability the grammar decides. */
export const FLOOR_ADVICE_CONFIDENCE = 0.8
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

const describe = (member: FloorMember) =>
  member.description?.trim() || `The ${member.handle.replace(/[_-]/g, ' ')} specialist.`

/** One `choice` question: the members other than the author, plus the person after a reply. */
export function floorDecisionRequest(question: FloorQuestion): Omit<DecisionRequest, 'signal'> {
  const author = question.members.find((member) => member.agentId === question.authorAgentId)
  const criteria = Object.fromEntries(
    question.members
      .filter((member) => member !== author)
      .map((member) => [member.handle, describe(member)]),
  )
  if (author)
    criteria[FLOOR_PERSON] =
      'The person who runs the chat: reads results, answers questions, gives the next task.'
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
    },
  }
}

/** The model's pick when it clears the confidence bar and names a valid option. */
export function confidentFloor(
  result: DecisionResult,
  request: Omit<DecisionRequest, 'signal'>,
): string | null {
  const answer = result.answers.next
  if (!answer || !(answer.choice in request.questions.next!.criteria)) return null
  return (answer.probabilities[answer.choice] ?? 0) >= FLOOR_ADVICE_CONFIDENCE
    ? answer.choice
    : null
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
