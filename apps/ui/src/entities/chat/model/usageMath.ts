import { cacheHitRate, combineUsage, uncachedInputTokens } from '@localixai/agent'

/**
 * Cache-hit rate as a whole percent: `cacheRead / inputTokens`. `inputTokens` is
 * the TOTAL context and ALREADY INCLUDES the cached subset (cacheRead+cacheWrite),
 * so the denominator is `inputTokens` — NOT `inputTokens + cacheRead` (that
 * double-counts the cached portion and understates the rate; it bit cache-stats.ts).
 * Returns null when there's no input or no cache figure. Pure, so the formula is
 * locked by a test against the intuitive-but-wrong denominator.
 */
export { cacheHitRate, combineUsage, uncachedInputTokens }
