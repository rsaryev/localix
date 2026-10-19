/**
 * DECISIONS — the decision-model seam the host offers to its own features and to plugins.
 *
 * A decision model (Jev through OpenRouter, System One protocol) writes no text: it reads a
 * structured `state` and answers typed questions — a pick among options, or the probability that a
 * statement is true — each with its probabilities, all in one pass. That makes it the cheap, fast
 * judge for "which of these", "is this one of those", "is this enough to act on".
 *
 * The host owns everything around the call, once for every consumer: which model answers and
 * through which connection (availability chooses — connecting OpenRouter turns it on), the
 * deadline, the spend in the usage ledger, and one log record per decision without its state.
 *
 * Advice, never a failure. Every way a decision can come back without answers — no model, late,
 * cancelled, refused — is an outcome with its reason, so a caller always has its own deterministic
 * path to fall back on and a decision model can never break the feature that asked. `decide`
 * rejects only for the caller's own mistake: a malformed purpose, or a session the user does not
 * own.
 */
import type { DecisionAnswer, DecisionQuestion } from '@localixai/agent/runtime'

export type {
  DecisionAnswer,
  DecisionBoolAnswer,
  DecisionBoolQuestion,
  DecisionChoiceAnswer,
  DecisionChoiceQuestion,
  DecisionQuestion,
} from '@localixai/agent/runtime'

/** What to decide: the state every question reads, and the questions by key. */
export interface DecisionAsk {
  state: Record<string, unknown>
  questions: Record<string, DecisionQuestion>
}

export interface DecisionOptions {
  /**
   * What the decision is for (`routing`, `browser.link`, `triage`): names it in the log. A plugin's
   * purpose is namespaced by the host (`plugin:<name>:<purpose>`).
   */
  purpose: string
  /** The session the decision serves: its spend is recorded against it. */
  sessionId: string
  /** How long the caller waits, resolution included. The host caps it (`DECISION_MAX_DEADLINE_MS`). */
  deadlineMs?: number
  signal?: AbortSignal
}

/** The default wait, and the longest one a caller may ask for. */
export const DECISION_DEFAULT_DEADLINE_MS = 3_000
export const DECISION_MAX_DEADLINE_MS = 15_000

/**
 * How a decision came back. `unavailable`: no live connection serves a decision model;
 * `deadline`: no answer in time; `cancelled`: the caller's signal; `failed`: the model or the
 * provider refused (details stay in the host's log).
 */
export type DecisionOutcome =
  | { status: 'answered'; model: string; ms: number; answers: Record<string, DecisionAnswer> }
  | { status: 'unavailable' | 'deadline' | 'cancelled' | 'failed'; model?: string; ms: number }

/** The host capability a plugin backend receives as `host.decisions`. */
export interface DecisionHost {
  /** The model that would answer for this user now, or null when none can. */
  available(userId: string): Promise<{ model: string } | null>
  decide(userId: string, ask: DecisionAsk, options: DecisionOptions): Promise<DecisionOutcome>
}

/** The pick of a `choice` answer when it reaches `confidence`, else null. */
export function confidentChoice(
  answer: DecisionAnswer | undefined,
  confidence: number,
): string | null {
  if (answer?.type !== 'choice') return null
  return (answer.probabilities[answer.choice] ?? 0) >= confidence ? answer.choice : null
}
