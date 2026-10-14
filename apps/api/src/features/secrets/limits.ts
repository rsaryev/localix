/**
 * The secret key/value LIMITS — the one owner, deliberately zod-free.
 *
 * `secretKeySchema` in `contracts.ts` is built FROM these, and the settings form
 * validates against these, so the client can no longer green-light a key the server
 * will 400 on. They live in their own module rather than in `contracts.ts` because a
 * VALUE import of the client barrel drags the server's zod schemas into the eager
 * browser chunk. Exported as `@localixai/api/secrets-limits`.
 *
 * Nothing here may import zod, or the leaf stops being a leaf.
 */

/** Max length of a secret KEY (the identifier inside a `secret:<KEY>` handle). */
export const SECRET_KEY_MAX_LENGTH = 128

/** Max length of a secret VALUE. */
export const SECRET_VALUE_MAX_LENGTH = 8192

/**
 * Allowed characters in a secret key: identifier-ish, so a key is safe to embed in
 * files, handles, and UI. Stateless (no `g` flag) — safe to share across callers.
 */
export const SECRET_KEY_PATTERN = /^[A-Za-z0-9_.-]+$/

/** The human phrasing of {@link SECRET_KEY_PATTERN}, shown by the server and the form. */
export const SECRET_KEY_HINT = 'letters, digits, and _ . - only'
