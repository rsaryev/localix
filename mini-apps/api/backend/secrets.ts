/**
 * Resolving `${secret:KEY}` tokens in a request's auth block.
 *
 * The vault itself is never imported: a resolver arrives through the generic mini app host seam
 * (`ctx.host.resolveSecret`) and is threaded in by the singleton. That keeps this mini app
 * portable — it depends on the SDK's token grammar, not on the API's secrets feature.
 *
 * Only auth fields are resolved. Headers and bodies are deliberately NOT scanned: a token there
 * would be a credential the user typed into a plaintext field, and silently making it work would
 * encourage exactly that. Auth is the one place we promise to keep secret.
 */

import { hasSecretTokens, resolveSecretTokens } from '@localixai/mini-app-sdk/backend'
import type { SecretConsumer } from '@localixai/mini-app-sdk/backend'
import type { RequestAuth } from './request-spec'

/**
 * `consumer` names the SAVED REQUEST whose auth is being resolved, so the vault's activity log
 * attributes the read to it. An ad-hoc send has no saved request to name and passes none.
 */
export type ResolveSecret = (
  userId: string,
  key: string,
  consumer?: SecretConsumer,
) => Promise<string | null>

/** The consumer type this mini app registers under, in the vault's own vocabulary. */
export const SECRET_CONSUMER_TYPE = 'api-request'

/** `auth.token`, `auth.password`, … — which field of a request holds the reference. */
export function secretConsumerFor(name: string, field: string): SecretConsumer {
  return { type: SECRET_CONSUMER_TYPE, id: name, field: `auth.${field}`, label: name }
}

/** The one secret-bearing field of an auth variant; everything else is a plain identifier. */
export type AuthSecretField = 'password' | 'token' | 'value'

/** The auth's secret-bearing field and its value, or null for a variant that carries none. */
export function authSecret(auth: RequestAuth): { field: AuthSecretField; value: string } | null {
  switch (auth.type) {
    case 'basic':
      return { field: 'password', value: auth.password }
    case 'bearer':
      return { field: 'token', value: auth.token }
    case 'apikey':
      return { field: 'value', value: auth.value }
    case 'none':
      return null
  }
}

/** A copy of `auth` with its secret-bearing field set to `value`; the variant is unchanged. */
export function withAuthSecret(auth: RequestAuth, value: string): RequestAuth {
  switch (auth.type) {
    case 'basic':
      return { ...auth, password: value }
    case 'bearer':
      return { ...auth, token: value }
    case 'apikey':
      return { ...auth, value }
    case 'none':
      return auth
  }
}

/** True when `auth` references the vault anywhere — used to decide whether a resolver is needed. */
export function authNeedsVault(auth: RequestAuth): boolean {
  const secret = authSecret(auth)
  return typeof secret?.value === 'string' && hasSecretTokens(secret.value)
}

/**
 * Return a copy of `auth` with every `${secret:KEY}` swapped for its literal.
 *
 * Throws when a token is present but the vault is unreachable, rather than sending the token
 * text as the credential: a request that fails loudly here is far cheaper than one that leaks
 * `${secret:STRIPE_KEY}` into a third party's access log.
 */
export async function resolveAuthSecrets(
  userId: string,
  auth: RequestAuth,
  resolve: ResolveSecret | undefined,
  /** The saved request this auth belongs to, when there is one — for the vault's audit trail. */
  requestName?: string,
): Promise<RequestAuth> {
  if (!authNeedsVault(auth)) return auth
  if (!resolve) {
    throw new Error(
      'This request references a stored secret, but the secrets store is unavailable. ' +
        'Reload the mini app, or replace the ${secret:KEY} reference with a literal value.',
    )
  }
  // `authNeedsVault` passed, so the variant has a secret field holding a reference.
  const { field, value } = authSecret(auth)!
  const consumer = requestName ? secretConsumerFor(requestName, field) : undefined
  return withAuthSecret(
    auth,
    await resolveSecretTokens(value, (key) => resolve(userId, key, consumer)),
  )
}
