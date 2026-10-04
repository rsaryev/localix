/**
 * Validate an external CLI agent's session id before it is used to build resume
 * argv. The id is captured from the agent's own NDJSON output (untrusted input);
 * the host spawns WITHOUT a shell, so the live risk is ARGUMENT injection — an id
 * like `-p` or `--dangerously-…` would be parsed as a flag (especially a positional
 * `resume <id>`), not a value. Real Claude/Codex ids are UUID/alphanumeric, so this
 * is permissive for valid ids and strict against injection.
 */

const MAX_SESSION_ID_LENGTH = 512

/**
 * True iff `id` is safe to place in argv: a non-empty, ≤512-char string with no
 * leading '-', no whitespace, and no control characters.
 */
export function isValidAgentSessionId(id: unknown): id is string {
  if (typeof id !== 'string') return false
  if (id.length === 0 || id.length > MAX_SESSION_ID_LENGTH) return false
  if (id.startsWith('-')) return false // would be read as a flag
  if (/\s/.test(id)) return false // no whitespace
  for (let i = 0; i < id.length; i++) {
    const code = id.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return false // no control chars
  }
  return true
}
