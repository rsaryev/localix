/**
 * Policy knobs for per-request wire compression.
 *
 * Kept separate from the compression engine so callers can depend on the
 * contract without pulling a large implementation module into type-only
 * dependency graphs.
 */
import type { Message } from '../types'

export interface PruneWireOptions {
  /**
   * Whether `ToolOutput` is present in the effective model tool roster.
   * Defaults to true for backward compatibility. When false, compression still
   * bounds the wire but emits reread/rerun guidance instead of a dead tool call.
   */
  recoveryToolAvailable?: boolean
  /** Protect roughly this many tokens of the most-recent messages. Default 16384. */
  keepRecentTokens?: number
  /** Always protect at least this many trailing messages. Default 4. */
  minKeepRecent?: number
  /** Only elide payloads larger than this many chars. Default 400 (~100 tokens). */
  minElideChars?: number
  /**
   * Don't crush unless the crushable (unlocked) region reaches this token count.
   * Zero (the default) disables the floor; runtime callers normally set one.
   */
  minReclaimTokens?: number
  /**
   * Don't crush while the whole request estimates below this many tokens.
   * Zero (the default) disables the gate.
   */
  pressureTokens?: number
  /**
   * HARD ceiling the request must fit under, as opposed to {@link pressureTokens},
   * which is only a "is compression worth it yet?" preference.
   *
   * A history above this is crushed even when it sits below the pressure gate and even
   * when the crushable region is under {@link minReclaimTokens} — those two early
   * returns mean "no NEW compression is worth it", which is not a licence to exceed the
   * budget. Boundary quantization is also dropped in that case, since re-protecting
   * messages for cache stability cannot outrank fitting at all.
   *
   * Zero / undefined (the default) disables the ceiling and reproduces the previous
   * behaviour exactly.
   */
  budgetTokens?: number
  /**
   * Fixed per-request cost not represented by messages: system prompt and tool
   * schemas. Included in the pressure-gate estimate. Default 0.
   */
  fixedOverheadTokens?: number
  /**
   * Optional provider-calibrated per-message estimate shared with admission.
   * Index is stable: pruning replaces content but never adds/removes messages.
   * New messages must remain uncalibrated until a provider measures them.
   */
  estimateMessageTokens?: (message: Message, index: number) => number
  /**
   * Round the protected-tail start down to a multiple of this many messages so
   * consecutive requests retain a stable, prompt-cache-friendly prefix.
   * Default 8; 1 disables quantization.
   */
  boundaryQuantum?: number
  /**
   * Maximum live, non-superseded read results protected outside the recent
   * window. Default 6. An explicit 0 is the protection's only off-switch.
   */
  maxLiveReads?: number
  /**
   * UTF-8 budget for protected live reads, newest first. Only a positive finite
   * value is treated as a budget; absent, zero, negative, and NaN use the safe
   * default. Use `maxLiveReads: 0` to disable the protection.
   */
  liveReadBudgetBytes?: number
  /**
   * Result-side monotonic-elision ratchet. Populate it with tool-call ids whose
   * results were already sent compressed so a later tail shift cannot inflate
   * them and invalidate the cached prefix.
   */
  elidedToolCallIds?: ReadonlySet<string>
  /**
   * Argument-side ratchet for heavy mutation arguments. This is deliberately
   * separate from the result ratchet because the two ids carry different facts.
   */
  elidedArgToolCallIds?: ReadonlySet<string>
}
