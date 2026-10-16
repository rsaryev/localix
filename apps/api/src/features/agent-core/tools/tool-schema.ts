/**
 * Shared input-schema tolerances (zod `preprocess` functions).
 *
 * A rejected tool call costs a full model round-trip: the agent sees `Invalid tool
 * input: …`, re-reads the schema, and re-issues the same intent in the shape we wanted.
 * On the recorded corpus the shapes models get wrong are always the same pair, and both
 * are unambiguous — the intent is never in doubt, only the JSON type:
 *
 *   27×  `bash.commands: expected array, received string`
 *    2×  `ask.loading_messages: expected array, received string`
 *    2×  `read.startLine: expected number, received string`
 *
 * So accept them. The philosophy: tolerate what can only
 * mean one thing, never guess when it could mean two. A string that is not a clean
 * integer is passed through so zod still reports the real type error; a string that
 * parses as a JSON array of strings is taken as that array, not as one element.
 *
 * These are `preprocess` inputs rather than finished schemas so each field keeps its
 * own constraints (`.min(1)`, `.max(4)`, per-item `.trim()`) and its own description.
 */

/** Wrap a lone string as a one-element array; parse a JSON array-of-strings literal. */
export function stringToArray(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) return parsed
    } catch {
      // Not JSON — fall through and treat the whole string as a single element.
    }
  }
  return [value]
}

/** Convert a decimal-integer string (`"12"`) to a number; leave anything else alone. */
export function stringToInteger(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : value
}
