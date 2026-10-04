/**
 * A history STAGE: one named, pure step of the pipeline that turns a message list into
 * another message list.
 *
 * Two kinds, and the difference is load-bearing:
 *
 *   - LOAD-BEARING stages carry a correctness rule. Cutting at a context boundary is one: if
 *     it throws and the pipeline shrugs, the model is re-sent a conversation the user
 *     cleared. Their failures propagate.
 *   - ADVISORY stages only save tokens — downscaling an image, spilling an attachment. A bug
 *     in one must cost the turn nothing, so the pipeline passes the input through and files
 *     a `failed` report (the fail-safe discipline `output-filters/index.ts` established for
 *     bash output).
 *
 * `mapStage` is how the arity invariant is kept: the per-request wire prune must never
 * change the MESSAGE COUNT, because the admission check measures an offset on the unpruned
 * list and applies it to the pruned one. Element-wise by construction beats a comment
 * asking the next author not to splice.
 */
import type { HistoryDropReason } from './port'

export interface StageContext {
  /** Budget the stage may plan against, in tokens. */
  budgetTokens: number
  /** Estimator shared by the whole pipeline, so two stages cannot disagree on a size. */
  estimate: (messages: readonly unknown[]) => number
  signal: AbortSignal
}

export interface StageOutcome<M> {
  messages: readonly M[]
  dropped?: { reason: HistoryDropReason; messageId?: string }[]
}

export interface HistoryStage<M> {
  name: string
  /**
   * `advisory` (default `false`): a throw is contained and the input passes through.
   * Load-bearing stages leave it false so a broken rule stops the turn instead of silently
   * changing what the model sees.
   */
  advisory?: boolean
  /**
   * `true` when the stage may only shrink. The pipeline discards a result whose estimate
   * grew past the allowance and reports `discarded_grew`.
   */
  shrinksOnly?: boolean
  run(messages: readonly M[], ctx: StageContext): StageOutcome<M> | Promise<StageOutcome<M>>
}

/**
 * A stage that rewrites messages ONE BY ONE. The message count is preserved by
 * construction, so the offset accounting downstream stays sound; return the same reference
 * for "no change" so the pipeline's change count stays honest.
 */
export function mapStage<M>(
  name: string,
  rewrite: (message: M, index: number, ctx: StageContext) => M,
  options: { advisory?: boolean; shrinksOnly?: boolean } = {},
): HistoryStage<M> {
  return {
    name,
    ...options,
    run(messages, ctx) {
      return { messages: messages.map((message, index) => rewrite(message, index, ctx)) }
    },
  }
}

/**
 * A stage that APPENDS to the end of the list — a runtime-context tail, an ephemeral
 * reminder. Returning `undefined` appends nothing, which is the common case.
 */
export function appendStage<M>(
  name: string,
  build: (messages: readonly M[], ctx: StageContext) => M | undefined,
  options: { advisory?: boolean } = {},
): HistoryStage<M> {
  return {
    name,
    ...options,
    run(messages, ctx) {
      const extra = build(messages, ctx)
      return { messages: extra === undefined ? messages : [...messages, extra] }
    },
  }
}
