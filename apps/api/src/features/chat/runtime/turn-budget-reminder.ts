/**
 * WHAT THE AGENT IS ALLOWED TO SPEND ON THIS RUN.
 *
 * An agent that does not know its budget cannot plan against it. Observed: a run capped at a
 * few turns opened a long investigation — read a file, grep, read another — and was cut off
 * before it said anything, because nothing had told it that this run was short. Told the
 * number, a model front-loads: it answers first and explores with what is left.
 *
 * Only when the cap is low enough to change behaviour. At the default nothing is emitted,
 * because "you have a thousand turns" is a sentence that costs tokens to say and cannot change
 * a single decision — and a reminder that is always present is one the model stops reading.
 *
 * It rides the ephemeral reminder message rather than the system prompt on purpose: the prompt
 * is the cached prefix, and a number that differs per run would invalidate that prefix on every
 * turn. The reminder message is appended at the END and never persisted, so the cache sees the
 * same bytes it saw last turn (`reminders.ts`, `run/stages/prompt.ts`).
 *
 * A module of its own because it is the one reminder that is not read off the transcript: every
 * other builder in `reminders.ts` answers "what does this history say", and this one answers
 * "what is this run allowed to do" — a fact about the run, from `contracts/turn-budget.ts`.
 */
import { wrapSystemReminder } from './system-reminder'
import { plural } from '../../../lib/plural'

/**
 * The cap above which the budget is not worth mentioning.
 *
 * A number a model cannot plan against is noise. Fifty turns is far more than an ordinary
 * answer spends, so a run under it is one somebody deliberately made short.
 */
const TURN_BUDGET_REMINDER_ABOVE = 50

export function buildTurnBudgetReminder(maxTurns: number | undefined): string | null {
  if (maxTurns === undefined || maxTurns >= TURN_BUDGET_REMINDER_ABOVE) return null
  return wrapSystemReminder([
    `This run stops after ${plural(maxTurns, 'agentic turn')} — a turn is one batch of tool calls, and the count is not shown to you as it is spent.`,
  ])
}
