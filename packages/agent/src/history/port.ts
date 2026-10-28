/**
 * THE HISTORY PORT: how a host turns a session's persisted history into the messages one
 * model request may see.
 *
 * There are two halves of that job and they were separate code paths with separate budget
 * arithmetic, separate token estimators and separate elision bookkeeping:
 *
 *   - MATERIALIZE, once per turn: persisted rows → the wire the run starts from.
 *   - TRANSFORM, before every request inside that run: the wire → the wire that fits now.
 *
 * A `HistoryStrategy` owns both, over one budget frame and one ratchet, so a rule cannot be
 * stated twice and drift. The host's one strategy, `chat-hybrid`, keeps the conversation and
 * compresses it recoverably.
 *
 * The port is deliberately provider-agnostic and DB-agnostic: it names messages, budgets and
 * reports. Implementations live in the host, where the repositories are.
 */
import type { AgentMessage } from '../agents/types'
import type { RuntimeContextPolicy } from '../runtime'

/**
 * The token arithmetic of one request, resolved once and shared by both halves.
 *
 * `trigger` is the whole-REQUEST ceiling; `historyBudget` is what is left for history after
 * the fixed overhead (system prompt + tool schemas). Deriving the second from the first is
 * the point: a history budget above the request ceiling promises the model context that the
 * next checkpoint is about to take away.
 */
export interface BudgetFrame {
  /** The model's declared context window, before any host cap. */
  rawWindow: number
  /** The window this run actually plans against (the host may cap it). */
  effectiveWindow: number
  /** System prompt + tool schemas: present in every request, never prunable. */
  fixedOverhead: number
  /** `effectiveWindow − reserve`: the whole-request ceiling. */
  trigger: number
  /** `trigger − fixedOverhead`: what history may occupy. */
  historyBudget: number
  /** Below this much headroom the compressing gate opens. */
  pressureTokens: number
  /** The recent tail that stays verbatim whatever the pressure. */
  keepRecentTokens: number
}

/** Where a context size came from. A measured anchor outranks any heuristic. */
export interface ContextEstimate {
  tokens: number
  source: 'provider_anchor' | 'heuristic'
}

/**
 * Why a stage dropped or degraded something. Named rather than free text so a host can
 * count the reasons across runs (the same discipline `context-fabric` applies to its
 * providers).
 */
export type HistoryDropReason = 'budget' | 'boundary' | 'superseded' | 'recoverable' | 'unsupported'

/** What one stage did, for diagnostics and for the never-worse accounting. */
export interface StageReport {
  stage: string
  /**
   * `applied` changed something, `noop` had nothing to do, `failed` threw and was skipped
   * (advisory stages only), `discarded_grew` produced a bigger result and was rejected.
   */
  status: 'applied' | 'noop' | 'failed' | 'discarded_grew'
  changedCount: number
  tokensBefore: number
  tokensAfter: number
  dropped?: { reason: HistoryDropReason; messageId?: string }[]
}

/** Everything the pure pipeline needs, after the impure intake has run. */
export interface MaterializeInput<M> {
  /** The turn's immutable inputs: messages, the volatile tail, reminder payloads. */
  frame: TurnFrame<M>
  budget: BudgetFrame
  /** The provider-measured size of the last comparable request, when one is proven. */
  anchor?: ContextEstimate
  signal: AbortSignal
}

/**
 * The turn's inputs as a VALUE. Everything side-effecting (hooks that may block, drains that
 * clear a buffer) happened before this existed, which is what makes materialize re-runnable:
 * a retry re-derives the wire from the same frame instead of re-firing hooks.
 */
export interface TurnFrame<M> {
  messages: readonly M[]
  /** The tool call this turn is answering, when the turn interrupts one. */
  activeInvocationId?: string
}

export interface MaterializeResult {
  wire: AgentMessage[]
  estimate: ContextEstimate
  /** Index of the message to mark as the provider cache anchor, or -1 for none. */
  cacheAnchorIndex: number
  reports: StageReport[]
}

/**
 * One run's history handling. Created per run so it can close over that run's ratchet state
 * (which results are already elided, the strongest compression each message has taken) —
 * the state that makes compression monotone and therefore cache-safe.
 */
export interface HistoryRun {
  materialize(input: MaterializeInput<unknown>): Promise<MaterializeResult>
  /**
   * The per-request half, handed to the adapter as its context policy.
   *
   * Implementations MUST keep the elision ledger current: which tool results are no longer
   * intact on the wire. The prune reads it back as its ratchet, so a stale ledger lets
   * compressed content come back verbatim and rewrites the cached prefix.
   */
  requestPolicy(init: {
    initialEstimate: ContextEstimate
    /** Is the recovery tool (`ToolOutput`) in this run's registry? */
    recoveryToolAvailable: boolean
  }): RuntimeContextPolicy
}

/** A named way of turning history into a request. Registered once, selected per run. */
export interface HistoryStrategy {
  readonly id: string
  createRun(context: HistoryRunContext): HistoryRun
}

/**
 * What a strategy needs from the host to build a run. Intentionally opaque here: the host
 * supplies repositories, stores and ports, and the port only requires that the same object
 * reaches both halves so they share one ratchet.
 */
export interface HistoryRunContext {
  sessionId: string
  budget: BudgetFrame
  /** Session-scoped ratchet + caches, owned by the host and reused across runs. */
  state: unknown
}

/** The set of strategies a host can select from. */
export interface HistoryStrategyRegistry {
  register(strategy: HistoryStrategy): void
  get(id: string): HistoryStrategy | undefined
  ids(): string[]
}
