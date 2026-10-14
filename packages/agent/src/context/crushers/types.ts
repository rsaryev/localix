/**
 * Shared contract for structural crushers. A crusher takes a tool-result string
 * and returns a smaller, structure-aware rewrite — or `null` when it doesn't apply
 * or wouldn't shrink the text (the caller then falls back to generic truncate).
 *
 * Crushers are PURE and deterministic: same input → same output, no I/O. That lets
 * the bench harness and unit tests measure compression ratio for free.
 */
export interface CrushResult {
  /** Compressed serialization to substitute for the original result text. */
  text: string
  beforeChars: number
  afterChars: number
  /** Units (rows / lines) actually emitted. */
  keptItems: number
  /** Units in the original. */
  totalItems: number
}
