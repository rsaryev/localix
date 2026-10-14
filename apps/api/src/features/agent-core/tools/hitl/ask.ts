import { z } from 'zod'
import { stringToArray, stringToInteger } from '../tool-schema'
import type { AgentTool, CallClass } from '@localixai/agent/agents'
import type { HumanInLoopRequestBase, HumanInLoopResponseBase } from '@localixai/agent/agents'
import { hitlOptionSchema, optionValue } from './hitl-options'
import {
  hitlDecisionDeadline,
  isHitlTimeout,
  unansweredError,
  unansweredRefusal,
} from './decision-deadline'
import { stillQueuedText, type AskQueuedDetails, type AskQueuePort } from './ask-queue'
import { queueQuestion, recallQuestions, writtenQuestions } from './ask-resolve'
import { TOOL } from '../../tool-names'

export const askToolOptionSchema = hitlOptionSchema

/**
 * `id` stays required because it is how the answer comes BACK: the result reads
 * `<id>: <choice>`, so a question without one would be answered anonymously.
 *
 * Two fields went: `allowCustom` was a "presentation hint" no client ever read (every question
 * already accepts free text), and `loading_messages` was REQUIRED although every surface falls
 * back to its own waiting line — a mandatory field the model had to invent on every question.
 */
export const askToolQuestionSchema = z.object({
  id: z.string().min(1).describe('Answer key: returns "<id>: <choice>".'),
  question: z.string().min(1),
  options: z.array(askToolOptionSchema).min(1),
  multi: z.boolean().optional().describe('Several may be chosen.'),
  recommended: z
    .preprocess(stringToInteger, z.number().int().min(0))
    .optional()
    .describe('Preselected option index (never auto-chosen).'),
})

/**
 * `wait` is the agent's one decision about a question: does the next step need the answer?
 * Blocking is right for a decision the work cannot go on without and wrong for a preference
 * that only makes the result better — that kind used to idle a whole run on a person who might
 * be away, and then expire unanswered. Defaults to blocking, which is what `ask` always did.
 */
export const askToolInputSchema = z.object({
  // Optional only because `from` can stand in for it; one of the two is required (execute).
  questions: z.array(askToolQuestionSchema).min(1).optional(),
  from: z
    .string()
    .min(1)
    .optional()
    .describe('Re-ask instead of questions: q-N, or an earlier ask call id.'),
  wait: z
    .boolean()
    .optional()
    .describe(
      'false if you can work on without it: returns q-N now; the answer arrives later as a message.',
    ),
  loading_messages: z
    .preprocess(stringToArray, z.array(z.string().trim().min(1).max(120)).min(1).max(4))
    .optional(),
})

export type AskToolInput = z.infer<typeof askToolInputSchema>

const QUESTION_KEYS = ['id', 'question', 'options', 'multi', 'recommended'] as const

/**
 * The runtime's pre-validation hook: it never runs the zod `preprocess`, so a bare
 * `loading_messages` string becomes its list here. One question written at the top level,
 * without the `questions` list around it, has one reading too: LOCALIX-189 lost a turn to it.
 */
export function prepareAskArguments(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  let input = raw as Record<string, unknown>
  if (input.loading_messages !== undefined) {
    const messages = stringToArray(input.loading_messages)
    if (messages !== input.loading_messages) input = { ...input, loading_messages: messages }
  }
  if (input.questions !== undefined || input.from !== undefined || input.question === undefined)
    return input
  const question: Record<string, unknown> = {}
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if ((QUESTION_KEYS as readonly string[]).includes(key)) question[key] = value
    else rest[key] = value
  }
  return { ...rest, questions: [question] }
}
export type AskToolQuestion = z.infer<typeof askToolQuestionSchema>
export type AskToolOption = z.infer<typeof askToolOptionSchema>

export interface AskToolAnswer {
  id: string
  question: string
  selectedOptions: string[]
  customInput?: string
}

export interface AskToolPayload {
  toolCallId: string
  loading_messages: string[]
  questions: AskToolQuestion[]
  /** The host can keep this question open after the person releases the waiting run. */
  canDefer?: boolean
}

export type AskToolRequest = HumanInLoopRequestBase<'ask', AskToolPayload>

/** A deferral supplies no answer and must not take the dismissal or timeout path. */
export class AskDeferredError extends Error {
  constructor() {
    super('The user chose to answer later')
    this.name = 'AskDeferredError'
  }
}

export interface AskToolResponsePayload {
  answers: AskToolAnswer[]
}

export type AskToolResponse = HumanInLoopResponseBase<'ask', AskToolResponsePayload>

/**
 * `request` is a BLOCKING ask's card; a queued one has none — nothing waits on it — and carries
 * `queued` instead, which the host rewrites when the person answers or skips it, so the transcript
 * card shows how it ended. `answers` is the one field both shapes fill.
 */
export interface AskToolDetails {
  request?: AskToolRequest
  response?: AskToolResponse
  answers?: AskToolAnswer[]
  queued?: AskQueuedDetails
  /** The questions, when `from` recalled them — the call's own input then carries none. */
  questions?: AskToolQuestion[]
  /** `from` named a queued question that is still open, so nothing new was asked. */
  stillOpen?: string
}

/**
 * There is no auto-ANSWER any more.
 *
 * This waited 180 seconds and then picked the recommended option (else the first) so the run
 * could continue rather than hang. The hang it avoided was real; the cure was worse. The run
 * went on as though a person had chosen, the transcript recorded an answer nobody gave, and
 * the model had no way to tell a considered choice from a timer — so "the user picked
 * Postgres" could mean the user was making coffee. A question whose answer nobody supplied
 * has no answer, and saying so is the only honest result. See `decision-deadline.ts`.
 */
const UNANSWERED_ASK_TAIL =
  'No option was chosen. Do not re-ask. Proceed on your own judgement and state the assumption you made, or stop and explain what you need decided.'

/** The same, plus the way to leave it for later — by this call's id, not written out again. */
const unansweredAskTail = (toolCallId: string, queueable: boolean) =>
  queueable
    ? `${UNANSWERED_ASK_TAIL} To leave it for the user to answer later, call ask with from: "${toolCallId}" and wait: false.`
    : UNANSWERED_ASK_TAIL

/**
 * Keep only what the questions allow: chosen values that are one of the question's options, one
 * of them unless the question is `multi`. Exported because a queued question's answer arrives
 * through the host's route, not this tool's promise, and must be held to the same rule.
 */
export function normalizeAskAnswers(
  input: { questions: readonly AskToolQuestion[] },
  submitted: readonly AskToolAnswer[],
): AskToolAnswer[] {
  const questions = new Map(input.questions.map((question) => [question.id, question]))
  const answeredIds = new Set(submitted.map((a) => a.id))

  for (const question of input.questions) {
    if (!answeredIds.has(question.id)) {
      console.warn(
        `[localixai/agent] ask tool: question "${question.id}" was not answered. Filling with empty selection.`,
      )
    }
  }

  return submitted.flatMap((answer) => {
    const question = questions.get(answer.id)
    // An answer to a question that was never asked is not an answer.
    if (!question) return []
    const allowed = new Set(question.options.map(optionValue))
    const selectedOptions = answer.selectedOptions.filter((value) => allowed.has(value))
    return {
      id: answer.id,
      question: question.question,
      selectedOptions: question.multi ? selectedOptions : selectedOptions.slice(0, 1),
      // A free-text answer is ALWAYS accepted — the UI offers "type a custom
      // answer" on every question.
      ...(answer.customInput !== undefined ? { customInput: answer.customInput } : {}),
    }
  })
}

/**
 * What one `ask` call reaches. Both shapes wait on a person, so an unattended session must refuse
 * them — but a read-only (plan) session must not: asking is how a plan gets its decisions. They
 * differ in where they land. A blocking ask holds the run and records nothing beyond the reply
 * (`read`); a queued one leaves a question in this conversation's strip that outlives the call
 * (`session`). Any `wait` that is not a boolean is a call the schema will refuse, answered with the
 * widest effect rather than guessed at.
 */
export function classifyAsk(input: unknown): CallClass {
  const wait = input && typeof input === 'object' ? (input as { wait?: unknown }).wait : null
  if (wait === false) return { effect: 'session', needsHuman: true }
  if (wait === undefined || wait === true) return { effect: 'read', needsHuman: true }
  return { effect: 'external', needsHuman: true }
}

/**
 * A blocking question in a run nobody watches used to reach the host, which refuses to surface
 * a card there — the call then failed on a controller error the model could not act on. Refuse it
 * up front instead, naming what still works.
 */
const noWatcherText = (queueable: boolean) =>
  queueable
    ? 'No one can answer a blocking question in this run. Call ask with wait: false to leave it for the user, or proceed on your own judgement and state the assumption you made.'
    : 'No one can answer a question in this run. Proceed on your own judgement and state the assumption you made, or stop and explain what you need decided.'

function formatAnswers(answers: AskToolAnswer[]): string {
  if (answers.length === 0) return 'User did not provide an answer.'
  return [
    'User answers:',
    ...answers.map((answer) => {
      if (answer.customInput !== undefined) return `${answer.id}: ${answer.customInput}`
      if (answer.selectedOptions.length > 1)
        return `${answer.id}: ${answer.selectedOptions.join(', ')}`
      return `${answer.id}: ${answer.selectedOptions[0] ?? '(no selection)'}`
    }),
  ].join('\n')
}

export function createAskTool(queue?: AskQueuePort): AgentTool<AskToolInput, AskToolDetails> {
  return {
    name: TOOL.ask,
    label: 'Ask',
    activeVerb: 'Awaiting user input',
    description:
      'Ask the user to decide when requirements are unclear, paths diverge, or confirmation is needed. They can always type an answer.',
    inputSchema: askToolInputSchema,
    prepareArguments: prepareAskArguments,
    executionMode: 'sequential',
    // A queued question persists in this conversation (`wait: false`), so the tool can write.
    mutates: true,
    classify: classifyAsk,
    async execute(toolCallId, input, signal, onUpdate, context) {
      // Both is ambiguous — which one did the agent mean to ask? — so neither is guessed at.
      if (input.from && input.questions)
        return { content: 'Give questions or from, not both.', isError: true }
      const asked = input.from ? await recallQuestions(queue, input.from) : writtenQuestions(input)
      if ('content' in asked) return asked
      if (input.wait === false) return queueQuestion(queue, toolCallId, asked)
      if (context?.interactive === false)
        return { content: noWatcherText(Boolean(queue)), isError: true }
      if (!context?.humanInLoop) {
        return {
          content: 'Cannot ask the user because no human-in-loop controller is configured.',
          isError: true,
        }
      }
      const recalled = asked.recalled ? { questions: asked.questions } : {}
      // Waiting now on a question that is still queued. The queued one is left OPEN until this
      // card ends in a person's decision: closing it first lost it to a restart or a stopped run
      // mid-wait, and handing it back afterwards renamed it (q-3 came back as q-7).
      const fromOpen = asked.openQuestionId
      const closeQueued = async () => {
        if (fromOpen) await queue?.supersede(fromOpen).catch(() => undefined)
      }

      const request: AskToolRequest = {
        id: toolCallId,
        kind: 'ask',
        payload: {
          toolCallId,
          loading_messages: input.loading_messages ?? [],
          questions: asked.questions,
          canDefer: Boolean(queue),
        },
        createdAt: Date.now(),
        // The one deadline every blocking card carries; the controller enforces it and
        // rejects with `HumanInLoopTimeoutError`. The bespoke `Promise.race` this replaces
        // was also the last place a second timeout value lived.
        expiresAt: hitlDecisionDeadline(),
      }

      onUpdate?.({ request })
      let result: AskToolResponse
      try {
        result = await context.humanInLoop.request<AskToolRequest, AskToolResponse>(request, signal)
      } catch (error) {
        if (error instanceof AskDeferredError) {
          // Reuse an open q-N when this was a blocking recall. Creating another question here
          // would rename it and allow two answers to the same decision.
          const queued = await queueQuestion(queue, toolCallId, asked)
          return {
            ...queued,
            content: `The user chose to answer later. No option was chosen. ${queued.content}`,
          }
        }
        // A person's Deny is a decision about the question: it leaves the queue too. Silence or a
        // stopped run decides nothing, and the queued question simply stays open.
        if (error instanceof Error && error.name === 'HumanInLoopDismissedError')
          await closeQueued()
        if (!isHitlTimeout(error)) throw error
        const content = fromOpen
          ? `${unansweredRefusal(UNANSWERED_ASK_TAIL)} ${stillQueuedText(fromOpen)}`
          : unansweredRefusal(unansweredAskTail(toolCallId, Boolean(queue)))
        return {
          content,
          isError: true,
          error: unansweredError(content),
          details: { request, ...recalled },
        }
      }
      // Answered here: the queued copy must not wait on (or wake the agent with) the same answer.
      await closeQueued()
      const answers = normalizeAskAnswers(asked, result.payload.answers)

      return {
        content: formatAnswers(answers),
        details: { request, response: result, answers, ...recalled },
      }
    },
  }
}
