/**
 * THE QUEUED HALF OF `ask` — a question the agent asks without stopping to wait.
 *
 * Everything the MODEL reads about a queued question is worded here, in one file, because the
 * three texts describe one contract and drift apart the moment they live next to their callers:
 *
 *   the call's result      it returned at once; keep working; the answer comes later;
 *   the answer's arrival   a turn (or a mid-run note) carrying what the person chose;
 *   the open-questions     a per-turn section listing what is still unanswered, so the agent
 *   section                neither re-asks it nor forgets it is outstanding.
 *
 * The host owns storage and delivery (`features/questions`, the chat question facade); the tool
 * reaches it through `AskQueuePort` and never learns where a question is kept.
 */
import type { AskToolAnswer, AskToolQuestion } from './ask'

/** What the host gives `ask` to queue a question. Absent ⇒ `wait: false` is refused. */
export interface AskQueuePort {
  queue(input: {
    toolCallId: string
    questions: AskToolQuestion[]
  }): Promise<{ questionId: string; superseded: string[] }>
  /**
   * An earlier question by the id the agent already holds — a queued one's `q-N`, or the
   * `tool_call_id` of an earlier `ask` — so re-asking it costs an id, not the whole question
   * written out again (the way `tool_output` serves an earlier result by its call id).
   * `openQuestionId` is set when it is a queued question still waiting for an answer.
   */
  recall(id: string): Promise<RecalledQuestion | { refused: string }>
  /** Close an open queued question that a blocking re-ask of it has settled. */
  supersede(questionId: string): Promise<void>
}

export interface RecalledQuestion {
  questions: AskToolQuestion[]
  openQuestionId?: string
}

/** How a queued question reads in the transcript card — `details.queued` of the `ask` item. */
export interface AskQueuedDetails {
  questionId: string
  status: 'pending' | 'answered' | 'skipped' | 'superseded'
  answeredAt?: string
}

/** The refusals a recall can answer with — worded here with every other text the agent reads. */
export const recallRefusal = {
  unknown: (id: string) =>
    `No earlier question "${id}" in this conversation. Pass a queued question's id (q-N) or the tool_call_id of an earlier ask, or write the questions out.`,
  notAsk: (id: string) => `"${id}" is not an ask call; only an earlier question can be re-asked.`,
  colleague: (id: string) =>
    `${id} was asked by another participant; it is theirs to re-ask. Ask your own question instead.`,
}

/** `from` with `wait: false` on a question that is still waiting: nothing new is queued. */
export function stillOpenText(questionId: string): string {
  return `${questionId} is still open — nothing new was queued, and its answer arrives on its own. If the next step now needs it, call ask with from: "${questionId}" and without wait: false to wait for it.`
}

/** A blocking re-ask of a queued question that nobody answered: the queued one is still open. */
export function stillQueuedText(questionId: string): string {
  return `${questionId} stays open in the queue, so the user can still answer it later; its answer arrives on its own.`
}

export function queuedResultText(questionId: string, superseded: readonly string[]): string {
  const replaced =
    superseded.length > 0
      ? ` It replaces ${superseded.join(', ')}, which you asked before with the same ids.`
      : ''
  return (
    `Queued as ${questionId}: the user will answer when they look.${replaced} ` +
    'Continue with the work that does not depend on the answer. The answer arrives on its own ' +
    `as a message marked "${questionId}" — do not ask it again as a new question, and do not poll for it. ` +
    `If you reach a point that truly cannot go on without it, call ask with from: "${questionId}" to wait for it.`
  )
}

const answerLine = (question: AskToolQuestion, answer: AskToolAnswer | undefined): string => {
  const label = (value: string) => question.options.find((o) => (o.value ?? o.label) === value)
  const chosen = (answer?.selectedOptions ?? []).map((value) => label(value)?.label ?? value)
  const typed = answer?.customInput?.trim()
  const said = [...chosen, ...(typed ? [`"${typed}"`] : [])]
  return `- ${question.id} (${question.question}): ${said.length > 0 ? said.join(', ') : '(no answer)'}`
}

/**
 * The text that reaches the agent when the person answers. It is the person's own input, framed
 * once here — a run already going takes it as-is at its next step, and an idle session runs a
 * turn on it, so both read the same words.
 */
export function queuedAnswerText(
  questionId: string,
  questions: readonly AskToolQuestion[],
  answers: readonly AskToolAnswer[],
): string {
  return [
    `[Answer to ${questionId}] The user answered the question you queued earlier:`,
    ...questions.map((question) =>
      answerLine(
        question,
        answers.find((answer) => answer.id === question.id),
      ),
    ),
    'Take it into account from here on. If the work it affects is already done another way, ' +
      'say what you assumed and whether it changes anything.',
  ].join('\n')
}

/** The note an agent gets when the person skipped one of its questions. */
export function queuedSkipText(questionId: string, question: string): string {
  return `The user skipped your queued question ${questionId} ("${question}") without answering. Do not ask it again; proceed on your own judgement and state the assumption you made.`
}

export interface OpenQuestionSnapshot {
  questionId: string
  /** The first question's text — the card's title. */
  question: string
  count: number
  askedAt: number
}

const age = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.round(s / 3600)}h`
}

/** The per-turn `# Open questions` section; null when nothing is open. */
/** What the per-turn section is built from, for one participant. */
export interface OpenQuestionsState {
  open: OpenQuestionSnapshot[]
  skipped: Pick<OpenQuestionSnapshot, 'questionId' | 'question'>[]
}

/**
 * The per-turn `# Open questions` section; null when there is nothing to say. `skipped` are the
 * questions the person declined since this agent last read the section — said once, here, because
 * a skip opens no turn and takes the question out of the open list without a word.
 */
export function buildOpenQuestionsSection(
  open: readonly OpenQuestionSnapshot[],
  now: number = Date.now(),
  skipped: readonly Pick<OpenQuestionSnapshot, 'questionId' | 'question'>[] = [],
): string | null {
  if (open.length === 0 && skipped.length === 0) return null
  const openLines =
    open.length === 0
      ? []
      : [
          'You queued these questions to the user and they are still unanswered:',
          ...open
            .slice(0, 8)
            .map(
              (q) =>
                `- ${q.questionId} · asked ${age(now - q.askedAt)} ago · ${q.question}${q.count > 1 ? ` (+${q.count - 1} more)` : ''}`,
            ),
          ...(open.length > 8 ? [`- … ${open.length - 8} more`] : []),
          'Their answers arrive as messages on their own. Do not ask them again as new questions; keep doing what does not depend on them. If the next step now needs one, ask with from: "q-N" waits for it.',
        ]
  return [
    '# Open questions',
    ...openLines,
    ...skipped.map((q) => queuedSkipText(q.questionId, q.question)),
  ].join('\n')
}
