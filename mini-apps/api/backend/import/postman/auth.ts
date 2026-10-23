/**
 * Postman auth → RequestAuth, including INHERITANCE.
 *
 * THE THING THAT MATTERS HERE. In a Postman collection a folder's auth is stored on the folder and
 * a request's on the request, and inheritance is resolved later, at runtime, by walking the parent
 * chain. Our model is flat — there is no parent chain to walk later — so a request with no `auth`
 * (or `auth: {type: 'inherit'}`) would import with none unless the importer threads it down.
 *
 * That is not an edge case, it is the NORMAL case: people set bearer auth once on the collection
 * and every request inherits it. Importing such a collection without threading auth down would
 * produce fifty requests that all 401, and the reason would be invisible — each one looks
 * perfectly well-formed. So the walk carries the nearest ancestor's auth and applies it wherever
 * the item does not override.
 */

import type { RequestAuth } from '../../request-spec'
import { pairValue, type PostmanAuth, type PostmanKeyValue } from './types'

/**
 * Read one field out of an auth payload, whichever version's shape it is in.
 *
 * Discriminating on `Array.isArray` rather than on the collection's declared `info.schema`: a real
 * collection's shape is what it is, and trusting the schema URL goes wrong when the two disagree.
 */
export function authField(payload: unknown, key: string): string {
  if (Array.isArray(payload)) {
    const found = (payload as PostmanKeyValue[]).find((p) => p.key === key)
    return found ? pairValue(found) : ''
  }
  if (payload && typeof payload === 'object') {
    const value = (payload as Record<string, unknown>)[key]
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  }
  return ''
}

export interface PostmanAuthResult {
  auth: RequestAuth
  /** A scheme Postman declared that we cannot sign — reported, never faked. */
  unsupported: string | null
}

const NONE: PostmanAuthResult = { auth: { type: 'none' }, unsupported: null }

/**
 * One Postman auth block → ours.
 *
 * `oauth2`, `awsv4`, `digest`, `oauth1`, `ntlm`, `hawk` return `unsupported` rather than a
 * lookalike. A request claiming an auth it cannot perform costs a debugging session; one that says
 * it is unauthenticated is a to-do. (Same rule as the OpenAPI importer's oauth2.)
 */
export function convertAuth(auth: PostmanAuth | undefined): PostmanAuthResult {
  const type = auth?.type?.toLowerCase()
  if (!auth || !type || type === 'noauth') return NONE
  // `inherit` is not an auth — it is the absence of one, and the caller resolves it.
  if (type === 'inherit') return NONE

  switch (type) {
    case 'bearer': {
      const token = authField(auth.bearer, 'token')
      return token ? { auth: { type: 'bearer', token }, unsupported: null } : NONE
    }
    case 'basic': {
      const username = authField(auth.basic, 'username')
      const password = authField(auth.basic, 'password')
      return username || password
        ? { auth: { type: 'basic', username, password }, unsupported: null }
        : NONE
    }
    case 'apikey': {
      const key = authField(auth.apikey, 'key')
      const value = authField(auth.apikey, 'value')
      if (!key) return NONE
      // Postman's `in` is 'header' (default) or 'query'.
      const where = authField(auth.apikey, 'in').toLowerCase()
      return {
        auth: { type: 'apikey', key, value, addTo: where === 'query' ? 'query' : 'header' },
        unsupported: null,
      }
    }
    default:
      return { auth: { type: 'none' }, unsupported: type }
  }
}

/**
 * The auth an item ends up with: its own, else the nearest ancestor's.
 *
 * `inherit` and "no auth block at all" both mean the same thing here — take the parent's. Postman
 * writes both, and treating them differently would make an import depend on which Postman version
 * happened to save the file.
 */
export function resolveAuth(
  own: PostmanAuth | undefined,
  inherited: RequestAuth,
): PostmanAuthResult {
  const type = own?.type?.toLowerCase()
  if (!own || !type || type === 'inherit') return { auth: inherited, unsupported: null }
  // An explicit `noauth` OVERRIDES an inherited credential — that is what it is for, and sending
  // an inherited token to an endpoint the author marked public is the opposite of what they wrote.
  if (type === 'noauth') return NONE
  return convertAuth(own)
}
