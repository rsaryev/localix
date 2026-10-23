/**
 * Telling the vault which saved requests reference which keys.
 *
 * A `${secret:KEY}` in a request's auth is a POINTER, and until now it was a pointer nobody on the
 * other end knew about. The vault has always been able to answer "what breaks if I delete this?" —
 * `remove` reports `in_use` with the consumer list rather than orphaning a reference — but the
 * binding table had no writers at all, so for every credential the honest answer was "nothing
 * known", and deleting a key silently broke every request that used it.
 *
 * So a save registers its references. That is the whole feature: no new permission, no value ever
 * read back. The mini app says "request `github-user` uses GITHUB_TOKEN in auth.token"; the vault
 * decides what to do with that.
 *
 * BEST-EFFORT ON PURPOSE. A failed bind must never fail the save: the request is valid and the
 * user's edit is theirs, while the binding is bookkeeping the vault can live without (and a host
 * that offers no binding registry omits the seam entirely). The cost of the weaker guarantee is a
 * stale entry, and `bind` is an upsert keyed by consumer+field, so a re-save repairs one.
 */

import { hasSecretTokens } from '@localixai/mini-app-sdk/backend'
import type { SecretConsumer } from '@localixai/mini-app-sdk/backend'
import type { RequestAuth } from './request-spec'
import { authSecret, secretConsumerFor } from './secrets'

export type BindSecret = (userId: string, key: string, consumer: SecretConsumer) => Promise<boolean>

/**
 * `${secret:KEY}` tokens are interpolated by the SDK, so a field may hold several — and the text
 * around them is not ours to parse loosely. This is the one place the KEY NAMES are extracted, and
 * it matches the SDK's own `${secret:…}` grammar rather than inventing a second reading of it.
 */
const SECRET_TOKEN_RE = () => /\$\{secret:([^}]+)\}/g

/** Every vault key an auth block references, paired with the field that holds it. */
export function authSecretReferences(auth: RequestAuth): Array<{ key: string; field: string }> {
  const secret = authSecret(auth)
  if (typeof secret?.value !== 'string' || !hasSecretTokens(secret.value)) return []
  const found: Array<{ key: string; field: string }> = []
  for (const match of secret.value.matchAll(SECRET_TOKEN_RE())) {
    const key = match[1]?.trim()
    if (key) found.push({ key, field: secret.field })
  }
  return found
}

/**
 * Register every reference in `auth` against the saved request `name`.
 *
 * Returns the keys it managed to bind — for tests and for a caller that wants to say so. Never
 * throws: see the header for why a failed bind must not take the save down with it.
 */
export async function bindAuthSecrets(
  userId: string,
  name: string,
  auth: RequestAuth,
  bind: BindSecret | undefined,
): Promise<string[]> {
  if (!bind) return []
  const bound: string[] = []
  for (const { key, field } of authSecretReferences(auth)) {
    try {
      if (await bind(userId, key, secretConsumerFor(name, field))) bound.push(key)
    } catch {
      // Bookkeeping. The save already happened and the request works.
    }
  }
  return bound
}
