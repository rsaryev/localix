import {
  SECRET_KEY_HINT,
  SECRET_KEY_MAX_LENGTH,
  SECRET_KEY_PATTERN,
  SECRET_VALUE_MAX_LENGTH,
} from '@localixai/api/secrets-limits'

/**
 * Client-side validation for the Secrets form, derived from the SAME constants the
 * server's `secretKeySchema` is built from.
 *
 * The form used to mirror only the key's regex — no length cap on either field — so a
 * 129-character key looked valid, lit up "Add", and then 400'd on the server. A mirror
 * that copies half a rule is a rule that drifts. VALUE import from the zod-free
 * `@localixai/api/secrets-limits` leaf, not the client barrel: importing a value from
 * the barrel would drag the server's zod contracts into the eager browser chunk.
 */

export { SECRET_KEY_MAX_LENGTH, SECRET_VALUE_MAX_LENGTH }

/** Why a draft key is not acceptable, or null when it is. */
export function secretKeyError(key: string): string | null {
  if (key.length === 0) return null // untouched — not an error, just not ready
  if (!SECRET_KEY_PATTERN.test(key)) return `Key: ${SECRET_KEY_HINT}`
  if (key.length > SECRET_KEY_MAX_LENGTH) {
    return `Key is too long (${key.length}/${SECRET_KEY_MAX_LENGTH} characters)`
  }
  return null
}

/** Why a draft value is not acceptable, or null when it is. */
export function secretValueError(value: string): string | null {
  if (value.length > SECRET_VALUE_MAX_LENGTH) {
    return `Value is too long (${value.length}/${SECRET_VALUE_MAX_LENGTH} characters)`
  }
  return null
}

/** True only when the server would accept this pair — the Add button's gate. */
export function canSubmitSecret(key: string, value: string): boolean {
  return (
    key.length > 0 &&
    value.length > 0 &&
    secretKeyError(key) === null &&
    secretValueError(value) === null
  )
}
