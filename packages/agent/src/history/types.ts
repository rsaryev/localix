/**
 * What a history pipeline reports and the turn it starts from: the types a host's history
 * strategy shares with the stage engine. The strategy itself lives in the host, where the
 * repositories are; nothing here knows a database or a provider.
 */

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
