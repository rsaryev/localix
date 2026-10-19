/**
 * WHICH DECISION MODELS ANSWER — the one place that names them.
 *
 * No consumer names a model: routing, plugins and whatever asks next go through the decision
 * service, which takes the first backend here that can answer for the user. Changing the model, or
 * adding a second one to fall back on, is an edit to this list; nothing that asks changes. A model
 * reached some other way than a provider connection (a local classifier) is another
 * {@link DecisionBackend}, composed in `bootstrap/decisions.ts`.
 */
import type { DecisionRequest, DecisionResult } from '@localixai/agent/runtime'

/** Catalog ids of the decision models Localix uses, preferred first. */
export const DECISION_MODELS = [
  // Jev, measured best at "who speaks next" (OpenRouter's System One protocol).
  'openrouter/~typesafe/jev-latest',
] as const

/** A decide bound to one way of reaching the model for one user. */
export interface ResolvedDecider {
  decide(request: DecisionRequest): Promise<DecisionResult>
  /** Whose spend it is in the ledger; null for a model that bills no connection. */
  providerConnectionId: string | null
  providerId: string
}

/** One decision model and how to reach it for a user. */
export interface DecisionBackend {
  /** Stable id named in the log and the ledger. */
  readonly model: string
  /** Null when the model cannot answer for this user now (no connection serves it). */
  resolve(userId: string): Promise<ResolvedDecider | null>
}
