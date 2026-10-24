import { z } from 'zod'
import { stringToArray, stringToInteger } from '../tool-schema'
import type { AgentTool, CallClass } from '@localixai/agent/agents'
import type { HumanInLoopRequestBase, HumanInLoopResponseBase } from '@localixai/agent/agents'
import { hitlOptionSchema, optionValue } from './hitl-options'
import { HITL_DECISION_MS, hitlDecisionDeadline, isHitlTimeout } from './decision-deadline'
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

export const askToolInputSchema = z.object({
  questions: z.array(askToolQuestionSchema).min(1),
  loading_messages: z
    .preprocess(stringToArray, z.array(z.string().trim().min(1).max(120)).min(1).max(4))
    .optional(),
  // Claude Code's AskUserQuestion `answers`: question text → choice. A hook sets it; the model
  // does not (its description says so), and a call that carries it is answered without a card.
  answers: z
    .record(z.string(), z.string())
    .optional()
    .describe('Set by a hook to answer programmatically; never set it yourself.'),
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
  if (input.questions !== undefined || input.question === undefined) return input
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
}

export type AskToolRequest = HumanInLoopRequestBase<'ask', AskToolPayload>

export interface AskToolResponsePayload {
  answers: AskToolAnswer[]
}

export type AskToolResponse = HumanInLoopResponseBase<'ask', AskToolResponsePayload>

/** `expired` marks a card nobody answered within the deadline; it renders neutral. */
export interface AskToolDetails {
  request?: AskToolRequest
  response?: AskToolResponse
  answers?: AskToolAnswer[]
  expired?: boolean
  /** The person chose Skip; renders neutral like an expired card. */
  skipped?: boolean
}

/**
 * There is no auto-ANSWER: a question nobody answered has no answer. The deadline is not an
 * error either — the person was away — so the model reads a plain instruction to go on.
 */
export const UNANSWERED_ASK_TEXT = `The human did not answer within ${HITL_DECISION_MS / 60_000} minutes. Continue with your best assumption and state it in your reply; ask again later only if it still blocks the work.`

/**
 * The person chose **Skip**: a decision, not a failure and not a permission refusal. The model
 * reads that it should go on without this answer rather than retrying the same question.
 */
export const SKIPPED_ASK_TEXT =
  'The human skipped this question. Continue with your best assumption and state it in your reply; do not ask the same question again unless it truly blocks the work.'

/**
 * Keep only what the questions allow: chosen values that are one of the question's options, one
 * of them unless the question is `multi`.
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
 * Every `ask` blocks on a person and persists nothing beyond its reply: a read that needs a human.
 * An unattended session refuses it; a read-only (plan) session must not — asking is how a plan
 * gets its decisions.
 */
export function classifyAsk(_input: unknown): CallClass {
  return { effect: 'read', needsHuman: true }
}

/** A run nobody watches cannot raise a card; refuse up front, naming what still works. */
export const NO_WATCHER_TEXT =
  'Nobody can answer here. Proceed with your best assumption and state it in your report.'

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

/** A hook's `answers` as the card's would be: a label of the question's options, else text. */
function givenAnswers(input: AskToolInput): AskToolAnswer[] | undefined {
  const answers = input.answers
  if (!answers || Object.keys(answers).length === 0) return undefined
  return input.questions.flatMap((q) => {
    const value = answers[q.question] ?? answers[q.id]
    if (value === undefined) return []
    const labels = value.split(',').map((label) => label.trim())
    const known = labels.every((label) => q.options.some((option) => option.label === label))
    return [
      known
        ? {
            id: q.id,
            question: q.question,
            selectedOptions: labels.map((l) => optionValueOf(q, l)),
          }
        : { id: q.id, question: q.question, selectedOptions: [], customInput: value },
    ]
  })
}

const optionValueOf = (q: AskToolQuestion, label: string) =>
  optionValue(q.options.find((option) => option.label === label)!)

export function createAskTool(): AgentTool<AskToolInput, AskToolDetails> {
  return {
    name: TOOL.ask,
    label: 'Ask',
    activeVerb: 'Awaiting user input',
    description:
      'Ask the user to decide when requirements are unclear, paths diverge, or confirmation is needed. Blocks until they answer (up to 5 minutes). They can always type an answer.',
    inputSchema: askToolInputSchema,
    prepareArguments: prepareAskArguments,
    executionMode: 'sequential',
    classify: classifyAsk,
    async execute(toolCallId, input, signal, onUpdate, context) {
      const given = givenAnswers(input)
      if (given) return { content: formatAnswers(given), details: { answers: given } }
      if (context?.interactive === false) return { content: NO_WATCHER_TEXT, isError: true }
      if (!context?.humanInLoop) {
        return {
          content: 'Cannot ask the user because no human-in-loop controller is configured.',
          isError: true,
        }
      }

      const request: AskToolRequest = {
        id: toolCallId,
        kind: 'ask',
        payload: {
          toolCallId,
          loading_messages: input.loading_messages ?? [],
          questions: input.questions,
        },
        createdAt: Date.now(),
        // The one deadline every blocking card carries; the controller enforces it and
        // rejects with `HumanInLoopTimeoutError`.
        expiresAt: hitlDecisionDeadline(),
      }

      onUpdate?.({ request })
      let result: AskToolResponse
      try {
        result = await context.humanInLoop.request<AskToolRequest, AskToolResponse>(request, signal)
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === 'HumanInLoopDismissedError' &&
          !signal?.aborted
        )
          return { content: SKIPPED_ASK_TEXT, details: { request, skipped: true } }
        if (!isHitlTimeout(error)) throw error
        return { content: UNANSWERED_ASK_TEXT, details: { request, expired: true } }
      }
      const answers = normalizeAskAnswers(input, result.payload.answers)

      return {
        content: formatAnswers(answers),
        details: { request, response: result, answers },
      }
    },
  }
}
