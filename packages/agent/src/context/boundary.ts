/**
 * Prompt-cache-friendly boundary quantization for context elision.
 *
 * Both elision layers (the VBC plan's hard-keep tail and `pruneWireMessages`'
 * protected window) anchor their keep-recent window at the TAIL of the history.
 * Un-quantized, every new message advances the window by one, flipping a
 * previously-verbatim mid-history message to elided — which breaks the provider
 * prompt-cache prefix at that point on EVERY request (repeated premium-billed
 * cache writes instead of cache reads).
 *
 * Fix: round the protected-tail START index DOWN to a multiple of a quantum Q.
 * Consecutive requests then share an identical elided prefix until the boundary
 * jumps Q messages forward at once. The window may temporarily protect up to
 * Q−1 extra messages — slightly more tokens in exchange for far better cache
 * hits. Rounding DOWN means quantization can only protect MORE messages than
 * the un-quantized window, never fewer, and (being a pure floor of a
 * monotonically advancing index) never moves the boundary backward across
 * calls for the same history.
 */

/** Default boundary quantum (messages). */
export const DEFAULT_BOUNDARY_QUANTUM = 8

/**
 * Quantize a protected-tail start index DOWN to a multiple of `quantum`.
 * `quantum <= 1` disables quantization (returns `start` unchanged).
 */
export function quantizeBoundaryStart(
  start: number,
  quantum: number = DEFAULT_BOUNDARY_QUANTUM,
): number {
  const q = Math.floor(quantum)
  if (!Number.isFinite(q) || q <= 1) return Math.max(0, start)
  return Math.max(0, Math.floor(start / q) * q)
}
