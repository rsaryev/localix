import { resolveContextWindow, resolveEffectiveContextWindow } from './agent-runner-constants'

/**
 * Window-scaled headroom reserved out of the context window for the next response and the
 * growth inside a run. Scales both ways: big windows reserve 10% (a 1M model reserves ~100k,
 * not a flat 16k), small windows reserve 20% (a flat 16k floor left a 32k model a 15.6k
 * ceiling — below the fixed prompt+tools cost, so every run overflowed; offline simulation).
 * Unchanged for the common 128k–256k range: max(min(16384, 20%), 10%) = 16384–25600.
 */
export function scaledReserveTokens(contextWindow: number): number {
  return Math.max(Math.min(16384, Math.floor(contextWindow * 0.2)), Math.floor(contextWindow * 0.1))
}

/**
 * One host-owned description of the context limits for a model request.
 *
 * `trigger` is the whole-request ceiling. `historyBudget` is the part left for
 * messages after subtracting the system prompt and tool schemas. Keeping both in
 * one value object prevents checkpoint planning, wire pruning, and preflight validation
 * from independently re-deriving subtly different limits.
 */
export interface ContextBudgetFrame {
  /** Catalog window (or Localix's conservative fallback when absent). */
  rawWindow: number
  /** Window Localix intentionally budgets against after applying its policy cap. */
  effectiveWindow: number
  /** Space retained for the next response and near-term request growth. */
  reserve: number
  /** System prompt and tool-schema estimate, absent from persisted history. */
  fixedOverhead: number
  /** Whole-request ceiling: `effectiveWindow - reserve`. */
  trigger: number
  /** Message-history allowance: `trigger - fixedOverhead`. */
  historyBudget: number
}

export interface ResolveContextBudgetOptions {
  /** Provider/model catalog context length. Missing or invalid uses the safe fallback. */
  contextWindow?: number
  /** Current system prompt + tool-schema estimate. */
  fixedOverheadTokens?: number
  /** The session's delegation depth — a child budgets against a smaller window. 0 if absent. */
  depth?: number
  /** Share of the real window to budget against (`clampContextPercent`). Default `DEFAULT_CONTEXT_PERCENT`. */
  contextPercent?: number
}

const normalizedTokens = (tokens: number | undefined): number =>
  typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : 0

/**
 * History allowance for an already-resolved effective window.
 *
 * Kept as a small public helper for the value-budgeted compressor, but the
 * arithmetic itself has one owner: this module.
 */
export function historyBudgetTokens(effectiveWindow: number, fixedOverheadTokens = 0): number {
  const window = normalizedTokens(effectiveWindow)
  if (window === 0) return 0
  const trigger = Math.max(0, window - scaledReserveTokens(window))
  return Math.max(0, trigger - normalizedTokens(fixedOverheadTokens))
}

/** Resolve the canonical context budget used by all host-side context controls. */
export function resolveContextBudgetFrame(
  options: ResolveContextBudgetOptions = {},
): ContextBudgetFrame {
  const model = { contextLength: options.contextWindow }
  const rawWindow = resolveContextWindow(model)
  const effectiveWindow = resolveEffectiveContextWindow(
    model,
    options.depth,
    options.contextPercent,
  )
  const reserve = scaledReserveTokens(effectiveWindow)
  const fixedOverhead = normalizedTokens(options.fixedOverheadTokens)
  const trigger = Math.max(0, effectiveWindow - reserve)
  const historyBudget = Math.max(0, trigger - fixedOverhead)

  return {
    rawWindow,
    effectiveWindow,
    reserve,
    fixedOverhead,
    trigger,
    historyBudget,
  }
}

export const LOCAL_CONTEXT_BUDGET_ERROR_CODE = 'LOCAL_CONTEXT_BUDGET_EXCEEDED' as const

export type LocalContextBudgetFailureReason =
  | 'fixed_overhead_too_large'
  | 'active_turn_too_large'
  | 'protected_history_too_large'
  | 'estimated_context_too_large'

export type ContextEstimateSource = 'provider_anchor' | 'heuristic'

export interface LocalContextBudgetErrorOptions {
  reason: LocalContextBudgetFailureReason
  frame: ContextBudgetFrame
  requiredTokens: number
  availableTokens: number
  estimateSource: ContextEstimateSource
  protectedMessageIds?: string[]
  message: string
}

/**
 * A Localix policy decision, deliberately distinct from a provider overflow.
 *
 * Callers can recover according to `reason` without scraping an error string.
 * In particular, an irreducible active turn should not enter an automatic
 * compact-and-retry loop, while an oversized old history may.
 */
export class LocalContextBudgetExceededError extends Error {
  readonly code = LOCAL_CONTEXT_BUDGET_ERROR_CODE
  readonly reason: LocalContextBudgetFailureReason
  readonly frame: ContextBudgetFrame
  readonly requiredTokens: number
  readonly availableTokens: number
  readonly estimateSource: ContextEstimateSource
  readonly protectedMessageIds: readonly string[]

  constructor(options: LocalContextBudgetErrorOptions) {
    super(options.message)
    this.name = 'LocalContextBudgetExceededError'
    this.reason = options.reason
    this.frame = options.frame
    this.requiredTokens = options.requiredTokens
    this.availableTokens = options.availableTokens
    this.estimateSource = options.estimateSource
    this.protectedMessageIds = options.protectedMessageIds ?? []
  }
}

/** System prompt + tool schemas alone leave no valid request-history envelope. */
export class FixedOverheadTooLargeError extends LocalContextBudgetExceededError {
  constructor(options: Omit<LocalContextBudgetErrorOptions, 'reason'>) {
    super({ ...options, reason: 'fixed_overhead_too_large' })
    this.name = 'FixedOverheadTooLargeError'
  }
}

/** An active user turn cannot be made smaller by compacting older history. */
export class ActiveTurnTooLargeError extends LocalContextBudgetExceededError {
  constructor(options: Omit<LocalContextBudgetErrorOptions, 'reason'>) {
    super({ ...options, reason: 'active_turn_too_large' })
    this.name = 'ActiveTurnTooLargeError'
  }
}

/** The permanently protected first task plus active turn exceed the history allowance. */
export class ProtectedHistoryTooLargeError extends LocalContextBudgetExceededError {
  constructor(options: Omit<LocalContextBudgetErrorOptions, 'reason'>) {
    super({ ...options, reason: 'protected_history_too_large' })
    this.name = 'ProtectedHistoryTooLargeError'
  }
}

/**
 * Fail before classifying any message as oversized when the fixed request floor
 * leaves no room for history at all. A checkpoint cannot reclaim system prompt or
 * schema tokens, so reporting this as an active/protected-history failure sends
 * users toward an ineffective recovery.
 *
 * The condition is an empty `historyBudget`, not merely an overhead ABOVE the
 * trigger: at exact equality the budget is already zero, so every non-empty active
 * turn was rejected as too large while the real cause — and the only useful advice,
 * to shed tools or prompt extensions — went unreported.
 */
export function assertFixedOverheadFits(frame: ContextBudgetFrame): void {
  if (frame.historyBudget > 0) return
  throw new FixedOverheadTooLargeError({
    frame,
    requiredTokens: frame.fixedOverhead,
    availableTokens: frame.trigger,
    estimateSource: 'heuristic',
    message:
      `The system prompt and tool schemas require approximately ${frame.fixedOverhead} of this ` +
      `model's ${frame.trigger}-token request budget, leaving no room for conversation history. ` +
      'Disable tools or prompt extensions, or switch to a model with a larger input capacity.',
  })
}
