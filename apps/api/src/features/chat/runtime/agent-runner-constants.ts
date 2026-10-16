import { contextLimitWindow, type ContextLimit } from '@localixai/agent'

// Model-facing context trim (a checkpoint's planContextCompression call, and the in-run
// wire prune): the most-recent turns are kept verbatim (the model's active working set);
// the allocator compresses older, lower-value tool I/O. Bounded by BOTH a message count
// and a token cap so the protected window can't dominate the budget. Real coding sessions
// re-bill huge write-arg file contents every turn — eliding them beyond this window
// (recoverable from disk) is the dominant near-lossless win (~78% on a measured session).
export const MODEL_TRIM_KEEP_RECENT = 8
export const MODEL_TRIM_KEEP_RECENT_TOKENS = 16384

// The kept-tail window scales MILDLY + BOUNDED with the model context window.
// A flat 16k tail on a 128k/1M model elides the older reads of a 3–5 file working set
// despite ample headroom, forcing tool_output round-trips. So we scale by a small
// FRACTION of the window, FLOORED at 16384 (small windows keep today's tail) and CAPPED
// at 65536, because the tail must stay bounded even on a 1M window. See
// resolveKeepRecentTokens.
//
// NB: callers pass the EFFECTIVE window (`resolveEffectiveContextWindow`), so the cap below
// binds once that window exceeds ~437k (e.g. a 1M model on a 400k or larger limit).
const MODEL_TRIM_KEEP_RECENT_FRACTION = 0.15
export const MODEL_TRIM_KEEP_RECENT_CAP = 65_536

/**
 * Per-request keep-recent token window for pruneWireMessages, scaled to the model's
 * context window: `clamp(FRACTION × contextWindow, TOKENS_floor, CAP)`. An unknown or
 * non-positive window falls back to the flat floor (16384) — i.e. current behavior.
 * Small windows (≤ ~109k) also stay at the floor, so this NEVER regresses; it only
 * widens the protected tail on large-window models that have the headroom.
 */
export function resolveKeepRecentTokens(contextWindow?: number): number {
  if (!contextWindow || contextWindow <= 0) return MODEL_TRIM_KEEP_RECENT_TOKENS
  const scaled = Math.round(MODEL_TRIM_KEEP_RECENT_FRACTION * contextWindow)
  return Math.min(MODEL_TRIM_KEEP_RECENT_CAP, Math.max(MODEL_TRIM_KEEP_RECENT_TOKENS, scaled))
}

// Per-request PRESSURE FLOOR for wire crushing (pruneWireMessages): only crush old
// recoverable tool I/O once the crushable region beyond the protected window is at
// least this large. Below it, the small saving isn't worth the prompt-cache churn
// or handing the model recovery pointers it doesn't need — the over-eager crushing
// behind endless-review re-read loops on small/mid sessions. 8k is
// deliberately conservative relative to the 16k protected window it sits behind.
export const MODEL_TRIM_MIN_RECLAIM_TOKENS = 8192

/**
 * Conservative window assumed when the catalog has no `contextLength`. Common for
 * drop-in / OpenRouter models (deepseek among them — a runaway
 * 87k→485k per-turn input was traced to exactly this hole).
 *
 * Every model-history and runtime-context path resolves through this fallback: a missing
 * catalog entry is not evidence of a small window, and budgeting against `undefined` would
 * put the checkpoint thresholds at zero — a checkpoint on every turn. One resolver feeds the
 * checkpoint policy, the in-run safety prune and the max-tokens clamp.
 */
export const DEFAULT_CONTEXT_WINDOW = 128_000

/**
 * The model's finite, integer context window, or the conservative default when
 * catalog metadata is absent or invalid.
 */
export function resolveContextWindow(catalogModel?: { contextLength?: number }): number {
  const cw = catalogModel?.contextLength
  return typeof cw === 'number' && Number.isFinite(cw) && cw > 0
    ? Math.floor(cw)
    : DEFAULT_CONTEXT_WINDOW
}

/**
 * The cap by DELEGATION DEPTH: a conversation is bounded only by its percent, its child by 128k,
 * every level below by 64k.
 *
 * A delegated child has one bounded assignment, and every request it makes re-reads its whole
 * history — so the full conversation window spent on a child is cost without a use, multiplied
 * by every child in the tree. The floor is 64k because below it the system prompt and tool
 * schemas (~15–20k) leave too little history for a checkpoint to keep anything.
 */
const CONTEXT_WINDOW_BY_DEPTH = [Number.POSITIVE_INFINITY, 128_000, 64_000] as const

export function contextWindowCapAt(depth: number): number {
  return CONTEXT_WINDOW_BY_DEPTH[Math.min(Math.max(0, depth), CONTEXT_WINDOW_BY_DEPTH.length - 1)]!
}

/**
 * The window a request must FIT UNDER: the window whose ceiling is the person's context limit for
 * this agent/model (`agentModelSettings[].contextLimit`, Auto = 272k; see `context-limit.ts`),
 * never beyond the model's own window, then capped by delegation depth — the ceiling the
 * checkpoint policy measures against and the budget a checkpoint's `planContextCompression`
 * spends.
 *
 * The invariant is pinned in `agent-runner-constants.test.ts`.
 */
export function resolveEffectiveContextWindow(
  catalogModel?: { contextLength?: number },
  depth = 0,
  contextLimit?: ContextLimit,
): number {
  const window = contextLimitWindow(resolveContextWindow(catalogModel), contextLimit)
  return Math.min(window, contextWindowCapAt(depth))
}

// The prompt-cache TTL policy that used to live here is now the ADAPTER's
// (`packages/agent-runtime-pi/src/cache-retention.ts`): the host reports the observed idle gap
// as `promptCacheIdleMs` and the provider's own cost model decides what that gap is worth.
// A TTL chosen here was Anthropic's price list written into a provider-neutral module.

// How often the in-flight assistant payload is flushed to the DB during a
// streaming turn. The UI still updates every chunk over SSE; the DB only needs
// a periodic checkpoint (final state is always written at message_end). At
// ~16ms/chunk a 120ms window cuts mid-turn DB writes ~8x and removes the O(n²)
// full-payload rewrites that silently inflated revealMs.
export const STREAM_DB_FLUSH_MS = 120
