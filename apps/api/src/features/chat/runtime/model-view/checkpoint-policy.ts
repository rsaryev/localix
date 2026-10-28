/**
 * WHEN a checkpoint is taken and HOW FAR it goes — the two numbers the whole mechanism hangs on,
 * in one place.
 *
 * Hysteresis is the design. A view trimmed a little whenever it crosses a line would rewrite the
 * cached prefix and the model's thinking chain on nearly every turn; a view cut at a high-water
 * mark down to a low one is rewritten once, and then only appended to for many turns. The low
 * mark is a cost decision as much as a quality one: every request re-reads the retained history
 * from cache, so keeping more costs on every request, while cutting lower costs a rewrite less
 * often. At 30% of the request ceiling the steady-state spend matches what LLM compaction used
 * to cost (a summarizer call over ~85% of the window, uncached), without the call and its wait.
 */
import type { ContextBudgetFrame } from '../context-budget'

/** A provider-measured request at this share of the ceiling takes a checkpoint next turn. */
export const CHECKPOINT_HIGH_WATER = 0.85

/**
 * Past this share the agent is told a checkpoint is near, so it can write down — into its
 * auto memory files, in its ordinary turn — whatever from the older turns must stay in force. That is
 * the one thing an LLM summary did that epoch cards cannot: carry a decision's reasons.
 */
export const CHECKPOINT_WARNING = 0.72

/** A checkpoint cuts the shown history down to this share of the request ceiling. */
export const CHECKPOINT_LOW_WATER = 0.3

/**
 * The retained history never shrinks below this share of what history may hold. On a small
 * window the system prompt and tools alone can take most of 30%, and a checkpoint that kept
 * almost nothing would checkpoint again on the next turn.
 */
export const CHECKPOINT_MIN_HISTORY_SHARE = 0.25

/** Share of the retained history the epoch cards may occupy. */
export const CHECKPOINT_CARD_SHARE = 0.12

/**
 * The request size that takes a checkpoint — what the in-run safety net prunes at, what the
 * usage ring and `ContextBudget` report, and what the next turn measures against.
 */
export function checkpointAtTokens(frame: Pick<ContextBudgetFrame, 'trigger'>): number {
  return Math.floor(frame.trigger * CHECKPOINT_HIGH_WATER)
}

/** Where a provider-measured request size sits against the checkpoint marks. */
export function checkpointPressure(
  frame: Pick<ContextBudgetFrame, 'trigger'>,
  tokens: number,
): 'due' | 'near' | 'clear' {
  if (tokens >= checkpointAtTokens(frame)) return 'due'
  return tokens >= frame.trigger * CHECKPOINT_WARNING ? 'near' : 'clear'
}

/** How many tokens the shown history may occupy after a checkpoint. */
export function checkpointTargetTokens(
  frame: ContextBudgetFrame,
  /** What this turn adds after the view: its own runtime context. */
  appendedTokens: number,
): number {
  const lowWater = Math.floor(frame.trigger * CHECKPOINT_LOW_WATER) - frame.fixedOverhead
  const floor = Math.floor(frame.historyBudget * CHECKPOINT_MIN_HISTORY_SHARE)
  return Math.max(0, Math.max(lowWater, floor) - appendedTokens)
}
