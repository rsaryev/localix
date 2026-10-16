/**
 * THE CONTEXT LIMIT — how many tokens a request may hold before a checkpoint reshapes the view,
 * chosen per agent/model the way a reasoning level is: from steps that model actually has.
 *
 * Tokens, not a share of the window. A share means a different thing on every model (30% of a
 * 272k model is 82k, of a 1M model 300k), and the useful range of a long context is an absolute
 * size: the strongest coding agents budget about 272k of input on every window from 400k to 1M,
 * because quality and cost fall well before an advertised million. So:
 *
 *   - Auto   — the default: `min(272k, full)`. A model at or under ~302k keeps its whole window.
 *   - steps  — a fixed ladder (128k … 10M), each offered only where the model's window holds it;
 *              larger windows get more steps without a code change.
 *   - Full   — the whole window minus the response reserve.
 *
 * One owner for the arithmetic the UI labels and the host budgets with, so the "272k" a person
 * picks is the request ceiling the runtime enforces.
 */

/** The default request ceiling on a window that holds it. */
export const CONTEXT_LIMIT_AUTO_TOKENS = 272_000

/** The fixed ladder; a model is offered the steps below its full ceiling. Auto is not repeated. */
export const CONTEXT_LIMIT_STEPS = [
  128_000, 200_000, 400_000, 600_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000,
] as const

/** A stored choice: a step's tokens, or the whole window. Absent means Auto. */
export type ContextLimit = number | 'full'

/** Largest step a stored value may name; anything above reads as Full. */
export const MAX_CONTEXT_LIMIT_TOKENS = CONTEXT_LIMIT_STEPS[CONTEXT_LIMIT_STEPS.length - 1]

/** Smallest stored step; below it a checkpoint could not keep anything (prompt + tools ~15–20k). */
export const MIN_CONTEXT_LIMIT_TOKENS = CONTEXT_LIMIT_STEPS[0]

/**
 * Window-scaled headroom reserved out of a window for the next response and the growth inside a
 * run. Big windows reserve 10% (a 1M model reserves ~100k, not a flat 16k), small windows 20% (a
 * flat 16k floor left a 32k model a 15.6k ceiling — below the fixed prompt+tools cost).
 * Unchanged for the common 128k–256k range: max(min(16384, 20%), 10%) = 16384–25600.
 */
export function scaledReserveTokens(contextWindow: number): number {
  return Math.max(Math.min(16384, Math.floor(contextWindow * 0.2)), Math.floor(contextWindow * 0.1))
}

/** The request ceiling a window leaves after its reserve. */
export function ceilingOfWindow(window: number): number {
  return Math.max(0, window - scaledReserveTokens(window))
}

/**
 * The smallest window whose ceiling is at least `ceiling` — the inverse of `ceilingOfWindow`
 * across the reserve's three regimes (20% up to 81 920, a flat 16 384 up to 163 840, 10% above).
 */
export function windowForCeiling(ceiling: number): number {
  const c = Math.max(0, Math.ceil(ceiling))
  const candidate =
    c <= 65_536 ? Math.ceil(c / 0.8) : c <= 147_456 ? c + 16_384 : Math.ceil(c / 0.9)
  // The reserve's floors can leave the candidate a token off either way; settle on the first fit.
  let window = candidate
  while (ceilingOfWindow(window) < c) window += 1
  while (window > 0 && ceilingOfWindow(window - 1) >= c) window -= 1
  return window
}

/** A stored value as the runtime reads it: unknown shapes are Auto, never an error. */
export function normalizeContextLimit(value: unknown): ContextLimit | undefined {
  if (value === 'full') return 'full'
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value > MAX_CONTEXT_LIMIT_TOKENS) return 'full'
  return Math.max(MIN_CONTEXT_LIMIT_TOKENS, Math.floor(value))
}

/**
 * The policy window a run budgets against: the window whose ceiling is the chosen limit, never
 * beyond the model's own window. Depth caps are the host's and apply after this.
 */
export function contextLimitWindow(rawWindow: number, limit?: ContextLimit): number {
  const chosen = normalizeContextLimit(limit)
  if (chosen === 'full') return rawWindow
  return Math.min(rawWindow, windowForCeiling(chosen ?? CONTEXT_LIMIT_AUTO_TOKENS))
}

export interface ContextLimitChoices {
  /** Auto's ceiling on this model. */
  auto: number
  /** Full's ceiling on this model. */
  full: number
  /** Ladder steps strictly between nothing and Full, Auto's own value excluded. */
  steps: number[]
  /** The choice in force, normalised (Auto is `undefined`). */
  current: ContextLimit | undefined
  /** The ceiling the current choice gives on this model. */
  currentTokens: number
  /** False when Auto already is the whole window — the setting has nothing to offer. */
  adjustable: boolean
}

/** What a model offers, like its reasoning levels: computed from its window, never stored. */
export function contextLimitChoices(rawWindow: number, value?: unknown): ContextLimitChoices {
  const full = ceilingOfWindow(rawWindow)
  const auto = Math.min(CONTEXT_LIMIT_AUTO_TOKENS, full)
  const steps = CONTEXT_LIMIT_STEPS.filter((step) => step < full && step !== auto)
  const current = normalizeContextLimit(value)
  return {
    auto,
    full,
    steps,
    current,
    currentTokens: ceilingOfWindow(contextLimitWindow(rawWindow, current)),
    adjustable: full > CONTEXT_LIMIT_AUTO_TOKENS,
  }
}

/** `128k`, `272k`, `1M`, `2.5M` — the compact token count the settings show. */
export function formatContextTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = Math.round(tokens / 100_000) / 10
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`
  }
  return `${Math.round(tokens / 1000)}k`
}
