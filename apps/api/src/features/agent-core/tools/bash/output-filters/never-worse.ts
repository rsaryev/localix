/**
 * Never-worse guard: a "filtered" output that is not
 * actually smaller than the raw one is discarded — filtering may only save
 * tokens, never add them.
 */
export function neverWorse(raw: string, filtered: string): string {
  return filtered.length < raw.length ? filtered : raw
}
