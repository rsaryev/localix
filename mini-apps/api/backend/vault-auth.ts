/**
 * Moving a literal credential into the vault, so a saved request holds a REFERENCE and never the
 * secret itself.
 *
 * This is the missing half of the mini app's own advice. Importing a cURL command with
 * `Authorization: Bearer ghp_abc` used to write that token, in the clear, into
 * `~/.localix/rest-requests/<user>.json`, and then print a note telling the user to "store it in
 * the vault and use a ${secret:KEY} reference" — advice with no path to follow, because a mini app
 * could resolve the vault but never fill it. Pasting a token and keeping it out of a plaintext
 * file were mutually exclusive. `ctx.host.storeSecret` is what closes that, and this module is
 * what spends it.
 *
 * Pure except for the injected `storeSecret` — the vault is never imported.
 */

import type { RequestAuth } from './request-spec'
import { authNeedsVault, authSecret, withAuthSecret } from './secrets'

/** Create-only vault write: false when the key was taken and nothing was written. */
export type StoreSecret = (userId: string, key: string, value: string) => Promise<boolean>

/**
 * A vault key from a request name: `api` scope + the request + the field.
 *
 * Scoped on purpose. The vault is one flat namespace shared with every other integration, so a
 * bare `GITHUB_TOKEN` minted from a request called `github` would be a name another mini app (or
 * the user) plausibly wants. A `REST_` prefix makes a collision mean "this mini app already vaulted
 * something for this request", which is a question we can answer, rather than "somebody else owns
 * this name", which is not ours to resolve.
 */
export function vaultKeyFor(requestName: string, field: string): string {
  const slug = requestName
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return `REST_${slug || 'REQUEST'}_${field.toUpperCase()}`
}

export interface VaultOutcome {
  /** The auth to persist — referencing the vault when a literal was moved. */
  auth: RequestAuth
  /** The key the literal now lives under, or null when there was nothing to move. */
  key: string | null
}

/**
 * Move `auth`'s literal credential into the vault and return auth that references it.
 *
 * Returns the auth UNCHANGED when there is nothing to do: no auth, or a value that is already a
 * `${secret:}` reference. A key collision suffixes rather than overwrites — two requests against
 * the same API legitimately carry two different tokens, and silently pointing the second at the
 * first's secret would send the wrong credential with no sign anything happened.
 *
 * A vault that refuses every candidate name leaves the literal in place rather than throwing: the
 * request still works, and a request that saves is strictly better than an import that fails. The
 * caller is told (`key: null`) so it can say so.
 */
export async function vaultLiteralAuth(
  userId: string,
  requestName: string,
  auth: RequestAuth,
  storeSecret: StoreSecret | undefined,
): Promise<VaultOutcome> {
  const secret = authSecret(auth)
  if (!secret || !storeSecret) return { auth, key: null }
  const { field, value: literal } = secret
  // Already a reference (or empty): nothing to move.
  if (typeof literal !== 'string' || literal === '' || authNeedsVault(auth)) {
    return { auth, key: null }
  }

  const base = vaultKeyFor(requestName, field)
  for (let n = 1; n <= 20; n++) {
    const key = n === 1 ? base : `${base}_${n}`
    if (await storeSecret(userId, key, literal)) {
      return { auth: withAuthSecret(auth, `\${secret:${key}}`), key }
    }
  }
  return { auth, key: null }
}
