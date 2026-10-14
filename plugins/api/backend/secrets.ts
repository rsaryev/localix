/**
 * Resolving `${secret:KEY}` tokens in a request's auth block.
 *
 * The vault itself is never imported: a resolver arrives through the generic plugin host seam
 * (`ctx.host.resolveSecret`) and is threaded in by the singleton. That keeps this plugin
 * portable — it depends on the SDK's token grammar, not on the API's secrets feature.
 *
 * Only auth fields are resolved. Headers and bodies are deliberately NOT scanned: a token there
 * would be a credential the user typed into a plaintext field, and silently making it work would
 * encourage exactly that. Auth is the one place we promise to keep secret.
 */

import { hasSecretTokens, resolveSecretTokens } from '@localixai/plugin-sdk/backend'
import type { SecretConsumer } from '@localixai/plugin-sdk/backend'
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

/** The consumer type this plugin registers under, in the vault's own vocabulary. */
export const SECRET_CONSUMER_TYPE = 'api-request'

/** `auth.token`, `auth.password`, … — which field of a request holds the reference. */
export function secretConsumerFor(name: string, field: string): SecretConsumer {
  return { type: SECRET_CONSUMER_TYPE, id: name, field: `auth.${field}`, label: name }
}

/** The secret-bearing field of each auth variant — everything else is a plain identifier. */
export const SECRET_FIELDS: Record<RequestAuth['type'], readonly string[]> = {
  none: [],
  basic: ['password'],
  bearer: ['token'],
  apikey: ['value'],
}

/** True when `auth` references the vault anywhere — used to decide whether a resolver is needed. */
export function authNeedsVault(auth: RequestAuth): boolean {
  const record = auth as unknown as Record<string, unknown>
  return SECRET_FIELDS[auth.type].some((field) => {
    const value = record[field]
    return typeof value === 'string' && hasSecretTokens(value)
  })
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
        'Reload the plugin, or replace the ${secret:KEY} reference with a literal value.',
    )
  }
  const out: Record<string, unknown> = { ...auth }
  // Every validated auth variant owns at most one secret-bearing field. Keep the
  // variant table as the source of truth without presenting this as a serial loop.
  const field = SECRET_FIELDS[auth.type][0]
  if (field) {
    const value = out[field]
    if (typeof value === 'string' && hasSecretTokens(value)) {
      const consumer = requestName ? secretConsumerFor(requestName, field) : undefined
      out[field] = await resolveSecretTokens(value, (key) => resolve(userId, key, consumer))
    }
  }
  // Only the secret-bearing fields of a validated variant were rewritten, and each stays a
  // string — the discriminant `type` is untouched, so the shape is the one we started with.
  return out as unknown as RequestAuth
}
