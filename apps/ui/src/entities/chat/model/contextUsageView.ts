import type { ChatUsagePayload } from '@localixai/agent'
import type {
  ContextAttemptSnapshot,
  ContextTokenKind,
  ContextWindowDiagnostics,
} from './contextUsage'

export interface ContextUsageInput {
  usage?: ChatUsagePayload
  latestAttempt?: ContextAttemptSnapshot
  contextDiagnostics?: ContextWindowDiagnostics
  contextWindow?: number
}

export interface UsageIndicatorView {
  attempt: {
    outcome: ContextAttemptSnapshot['outcome']
    stage: ContextAttemptSnapshot['stage']
    contextTokens?: number
    tokenKind: ContextTokenKind
  } | null
  physicalWindowTokens?: number
  policyWindowTokens?: number
  /** The whole-request ceiling — the usage denominator when known. */
  ceilingTokens?: number
  /** Where the next context checkpoint rewrites the model's view. */
  checkpointAtTokens?: number
  reservedTokens?: number
  fraction: number | null
  percentLabel: string
  fractionBasis: 'ceiling' | 'policy-window' | 'physical-window' | 'unknown'
  lastSuccessIsLatest: boolean
}

/**
 * Pure view-model builder: all provenance and denominator choices are pinned by
 * tests without coupling them to tooltip markup.
 */
export function buildUsageIndicatorView({
  usage,
  latestAttempt,
  contextDiagnostics,
  contextWindow,
}: ContextUsageInput): UsageIndicatorView {
  const physicalWindowTokens =
    contextDiagnostics?.fullWindowTokens && contextDiagnostics.fullWindowTokens > 0
      ? contextDiagnostics.fullWindowTokens
      : contextWindow && contextWindow > 0
        ? contextWindow
        : undefined
  const policyWindowTokens =
    contextDiagnostics?.policyWindowTokens && contextDiagnostics.policyWindowTokens > 0
      ? contextDiagnostics.policyWindowTokens
      : undefined
  const positive = (tokens: number | undefined) => (tokens && tokens > 0 ? tokens : undefined)
  const ceilingTokens = positive(contextDiagnostics?.ceilingTokens)
  const checkpointAtTokens = positive(contextDiagnostics?.checkpointAtTokens)
  const reservedTokens =
    contextDiagnostics?.reservedTokens && contextDiagnostics.reservedTokens > 0
      ? contextDiagnostics.reservedTokens
      : undefined

  let attempt: UsageIndicatorView['attempt'] = latestAttempt
    ? {
        outcome: latestAttempt.outcome,
        stage: latestAttempt.stage,
        contextTokens: latestAttempt.contextTokens,
        tokenKind: latestAttempt.tokenKind,
      }
    : usage
      ? {
          outcome: 'succeeded',
          stage: 'provider',
          contextTokens: usage.contextTokens,
          tokenKind: usage.contextTokens === undefined ? 'unknown' : 'measured',
        }
      : null

  // A failed or preflight attempt can have no provider usage while the
  // runtime still knows its resident-context estimate. Surface that estimate,
  // but keep its provenance explicit.
  const activeTokens = contextDiagnostics?.activeTokens
  if (
    attempt &&
    attempt.contextTokens === undefined &&
    activeTokens !== undefined &&
    Number.isFinite(activeTokens) &&
    activeTokens >= 0
  ) {
    attempt = {
      ...attempt,
      contextTokens: activeTokens,
      tokenKind: contextDiagnostics?.activeTokensKind ?? 'estimated',
    }
  }

  const basis = ceilingTokens ?? policyWindowTokens ?? physicalWindowTokens
  const fractionBasis = ceilingTokens
    ? 'ceiling'
    : policyWindowTokens
      ? 'policy-window'
      : physicalWindowTokens
        ? 'physical-window'
        : 'unknown'
  const rawFraction =
    attempt?.contextTokens === undefined || !basis
      ? null
      : Math.max(attempt.contextTokens / basis, 0)
  const fraction = rawFraction === null ? null : Math.min(rawFraction, 1)

  return {
    attempt,
    physicalWindowTokens,
    policyWindowTokens,
    ceilingTokens,
    checkpointAtTokens,
    reservedTokens,
    fraction,
    // Clamp only the progress fill. The label must preserve overflow
    // evidence (for example 101%) instead of visually rewriting it to 100%.
    percentLabel: rawFraction === null ? '—' : `${Math.round(rawFraction * 100)}%`,
    fractionBasis,
    lastSuccessIsLatest: attempt?.outcome === 'succeeded',
  }
}
