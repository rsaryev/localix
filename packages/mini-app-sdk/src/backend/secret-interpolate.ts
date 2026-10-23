/**
 * Secret interpolation for config strings. A stored config may embed `${secret:KEY}`
 * tokens (e.g. inside a database connection URL) so the persisted file never holds raw
 * credentials — the value is filled in server-side, at use time, from the secrets store.
 * The token wraps the same `secret:<KEY>` handle shape used elsewhere.
 */
/** The token pattern's source. Kept as a string so every use builds its OWN regex
 *  instance — a shared global (`/g`) regex carries `lastIndex` state between calls, and
 *  a preceding `.test()` would leave it advanced so a later `matchAll` starts PAST the
 *  token and silently finds nothing (see `newTokenRe`). */
const SECRET_TOKEN_SOURCE = String.raw`\$\{secret:([A-Za-z0-9_.-]+)\}`

/** A fresh global regex for the token. Never share one instance across calls — its
 *  `lastIndex` is mutable state. */
const newTokenRe = () => new RegExp(SECRET_TOKEN_SOURCE, 'g')

export function hasSecretTokens(input: string): boolean {
  return newTokenRe().test(input)
}

/**
 * Replace every `${secret:KEY}` in `input` with its resolved value. Throws if a
 * referenced secret is missing, so a caller (e.g. a DB connect) fails loudly rather
 * than proceeding with a malformed/empty credential.
 */
export async function resolveSecretTokens(
  input: string,
  resolve: (key: string) => Promise<string | null>,
): Promise<string> {
  const keys = new Set<string>()
  for (const m of input.matchAll(newTokenRe())) keys.add(m[1])
  if (keys.size === 0) return input

  const orderedKeys = [...keys]
  const resolved = await Promise.all(orderedKeys.map((key) => resolve(key)))
  const values = new Map<string, string>()
  for (let index = 0; index < orderedKeys.length; index += 1) {
    const key = orderedKeys[index]
    const value = resolved[index]
    if (value == null) throw new Error(`Secret not found: ${key}`)
    values.set(key, value)
  }
  return input.replace(newTokenRe(), (_full, key: string) => values.get(key) ?? '')
}
