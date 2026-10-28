import type { MiniAppContext } from './context'
import { confidentChoice, type DecisionOutcome } from './decision'
import type { MiniAppWakeOutcome } from './host-services'

/**
 * JUDGMENT — the three ways a mini app reaches the host's models, each with its own way out.
 *
 * A mini app keeps state and shows it; understanding belongs to the models beside it. Each helper
 * answers instead of throwing when no model can, so the app's own deterministic path always runs:
 *
 * - {@link decide}: a small, frequent pick (which column, which of a few options) by a decision model.
 * - {@link rankByMeaning}: candidates ordered by meaning with the embedding model on this computer.
 * - {@link askAgent}: a turn of the chat agent, for what needs real judgment or words.
 */

/** Who the judgment is for: the host's user and the chat it serves (`c.env`, `context.session`). */
export interface JudgmentChat {
  userId: string
  sessionId: string
}

export type DecisionMissReason = Exclude<DecisionOutcome['status'], 'answered'> | 'unsure'

export type DecisionResult<K extends string> =
  | { pick: K; by: 'model' }
  | { pick: K; by: 'fallback'; reason: DecisionMissReason }

/**
 * Ask a decision model to pick one of `options` for `state`. Below `confidence` (default 0.7), or
 * when no decision model answers, the pick is `fallback`, with the reason.
 */
export async function decide<K extends string>(
  ctx: Pick<MiniAppContext, 'host'>,
  request: JudgmentChat & {
    /** What the decision is for (`triage`): names it in the host's log and usage. */
    purpose: string
    /** The facts the model reads. Compute what code can know; let the model weigh it. */
    state: Record<string, unknown>
    question: string
    /** Option key → what it means. */
    options: Record<K, string>
    fallback: NoInfer<K>
    confidence?: number
    deadlineMs?: number
  },
): Promise<DecisionResult<K>> {
  const decisions = ctx.host?.decisions
  const miss = (reason: DecisionMissReason): DecisionResult<K> => ({
    pick: request.fallback,
    by: 'fallback',
    reason,
  })
  if (!decisions) return miss('unavailable')
  const outcome = await decisions.decide(
    request.userId,
    {
      state: request.state,
      questions: {
        answer: { type: 'choice', instructions: request.question, criteria: request.options },
      },
    },
    {
      purpose: request.purpose,
      sessionId: request.sessionId,
      ...(request.deadlineMs ? { deadlineMs: request.deadlineMs } : {}),
    },
  )
  if (outcome.status !== 'answered') return miss(outcome.status)
  const pick = confidentChoice(outcome.answers.answer, request.confidence ?? 0.7)
  return pick !== null && pick in request.options
    ? { pick: pick as K, by: 'model' }
    : miss('unsure')
}

/**
 * `items` nearest in meaning to `query` first, by the embedding model on this computer. While the
 * model cannot run (downloading, off), the items keep their given order and `by` says so.
 */
export async function rankByMeaning<T>(
  ctx: Pick<MiniAppContext, 'host'>,
  query: string,
  items: readonly T[],
  text: (item: T) => string,
): Promise<{ items: T[]; by: 'model' | 'fallback' }> {
  const ranking = await ctx.host?.semantic?.rank(
    query,
    items.map((item, index) => ({ key: String(index), text: text(item) })),
    { task: 'similarity' },
  )
  if (!ranking) return { items: [...items], by: 'fallback' }
  return { items: ranking.ranked.flatMap(({ key }) => items[Number(key)] ?? []), by: 'model' }
}

/**
 * Start a turn of the chat agent: `message` says what happened, `tools` are the app's own tools it
 * answers with. For events the agent did not cause (a click, a timer) — never from the app's own
 * tool, whose call would wake the agent again. Answers `missed` when this load cannot wake a chat.
 */
export async function askAgent(
  ctx: Pick<MiniAppContext, 'host'>,
  request: JudgmentChat & { message: string; tools?: readonly string[]; key?: string },
): Promise<MiniAppWakeOutcome> {
  const wake = ctx.host?.wake
  if (!wake) return { status: 'missed', reason: 'This app cannot wake a chat here.' }
  return wake(request)
}
