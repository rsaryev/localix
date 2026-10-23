/**
 * `securitySchemes` + `security` → a RequestAuth.
 *
 * What matters is what an imported credential POINTS AT. A spec never contains a secret — it
 * describes the shape of one — so the importer must produce auth with no value. We have a vault, so
 * we emit a `${secret:KEY}` reference: a "fill this in later" pointed at the store that encrypts it
 * rather than at a plaintext environment.
 *
 * A dangling reference is DELIBERATE and safe. `resolveAuthSecrets` throws "Secret not found" at
 * send time, so an unfilled import fails loudly, naming the key to create. The alternative — auth
 * with an empty value — sends an `Authorization: Bearer ` header and gets a 401 that reads like an
 * API problem instead of a setup step.
 */

import type { RequestAuth } from '../../request-spec'
import { resolveRef } from './pointer'
import type { OADocument, OASecurityScheme } from './types'

/**
 * The vault key an imported scheme references. Namespaced like every other key this mini app mints.
 */
export function securityKeyFor(apiSlug: string, schemeName: string): string {
  const slug = (s: string) =>
    s
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase()
  const api = slug(apiSlug) || 'API'
  const scheme = slug(schemeName) || 'AUTH'
  return `REST_${api}_${scheme}`
}

export interface SecurityResult {
  auth: RequestAuth
  /** The vault key the auth references, or null when the operation needs no auth. */
  key: string | null
  /** A scheme we recognised but cannot sign — reported so the import does not silently drop it. */
  unsupported: string | null
}

const NONE: SecurityResult = { auth: { type: 'none' }, key: null, unsupported: null }

/**
 * Pick the auth for one operation.
 *
 * `security` on the operation REPLACES the document's — it does not merge. That is the spec's own
 * rule, and it is what makes `security: []` mean "this endpoint is public" rather than "no
 * override". So the check must distinguish an absent key from an empty array; `??` does, `||`
 * would not.
 */
export function authForOperation(
  document: OADocument,
  apiSlug: string,
  operationSecurity: Record<string, string[]>[] | undefined,
): SecurityResult {
  const requirements = operationSecurity ?? document.security
  if (!Array.isArray(requirements) || requirements.length === 0) return NONE

  const schemes = document.components?.securitySchemes ?? {}
  let unsupported: string | null = null

  // A requirement object with several keys is an AND (all must be satisfied); the array is an OR.
  // We can carry exactly one credential, so we take the first requirement we can actually sign and
  // report anything we had to pass over.
  for (const requirement of requirements) {
    for (const name of Object.keys(requirement)) {
      const scheme = resolveRef<OASecurityScheme>(document, schemes[name])
      if (!scheme) continue
      const auth = authFromScheme(scheme, securityKeyFor(apiSlug, name))
      if (auth) return { auth, key: securityKeyFor(apiSlug, name), unsupported: null }
      unsupported ??= scheme.type ?? name
    }
  }
  return { ...NONE, unsupported }
}

/**
 * One scheme → auth, or null when we cannot sign it.
 *
 * `oauth2` and `openIdConnect` return null ON PURPOSE. Importing them as some other auth type
 * would produce a request that cannot work, and a request that claims an auth it does not have is
 * worse than one that says it is unauthenticated — the first wastes a debugging session, the
 * second is a to-do. (Carrying oauth2 needs a flow engine to run it. When ours grows one —
 * `ctx.oauth` is the seam — this is the one function that changes.)
 */
function authFromScheme(scheme: OASecurityScheme, key: string): RequestAuth | null {
  const ref = `\${secret:${key}}`
  switch (scheme.type) {
    case 'http': {
      const httpScheme = scheme.scheme?.toLowerCase()
      if (httpScheme === 'bearer') return { type: 'bearer', token: ref }
      if (httpScheme === 'basic') return { type: 'basic', username: '', password: ref }
      return null // digest, negotiate, … — named in the spec, unsignable by us
    }
    case 'apiKey': {
      if (!scheme.name) return null
      const addTo = scheme.in === 'query' ? 'query' : scheme.in === 'cookie' ? 'cookie' : 'header'
      return { type: 'apikey', key: scheme.name, value: ref, addTo }
    }
    // oauth2 / openIdConnect / mutualTLS, and a scheme with no `type` at all — a spec in the
    // wild is not obliged to be valid. Named rather than swept into a bare `default`, so adding
    // an auth variant is a compile error here.
    case 'oauth2':
    case 'openIdConnect':
    case 'mutualTLS':
    case undefined:
    default:
      return null
  }
}
