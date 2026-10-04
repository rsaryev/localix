/**
 * The slice of a Postman v2 collection this importer reads.
 *
 * Hand-written and defensively optional, for the same reason as the OpenAPI types: this arrives
 * from `JSON.parse`, so it is `unknown` whatever the schema claims. A recursive item union is
 * unsound against real data.
 */

/** A value that is `{key, value}` in 2.1 and a bare object in 2.0. See `auth.ts`. */
export interface PostmanKeyValue {
  key?: string
  value?: unknown
  type?: string
  /** 2.0's flag. Its ABSENCE means enabled — see the trap note in postman.ts. */
  enabled?: boolean
  /** 2.1's flag. */
  disabled?: boolean
  /** formdata `type: 'file'` carries its path here rather than in `value`. */
  src?: unknown
}

export interface PostmanUrl {
  raw?: string
  protocol?: string
  host?: string[] | string
  port?: string
  path?: string[] | string
  query?: PostmanKeyValue[]
  /** Postman's `/:id` path variables. */
  variable?: PostmanKeyValue[]
}

export interface PostmanBody {
  mode?: string
  raw?: string
  options?: { raw?: { language?: string } }
  urlencoded?: PostmanKeyValue[]
  formdata?: PostmanKeyValue[]
  graphql?: { query?: string; variables?: unknown }
  file?: { src?: string }
}

/** `auth[type]` is an ARRAY in 2.1 and an OBJECT in 2.0. */
export type PostmanAuthPayload = PostmanKeyValue[] | Record<string, unknown> | undefined

export interface PostmanAuth {
  type?: string
  basic?: PostmanAuthPayload
  bearer?: PostmanAuthPayload
  apikey?: PostmanAuthPayload
  [scheme: string]: unknown
}

export interface PostmanRequest {
  method?: string
  header?: PostmanKeyValue[] | string
  url?: PostmanUrl | string
  body?: PostmanBody
  auth?: PostmanAuth
}

export interface PostmanItem {
  name?: string
  /** Present ⇒ a request. Absent ⇒ a folder. This is Postman's only discriminator. */
  request?: PostmanRequest | string
  /** A folder's children. */
  item?: PostmanItem[]
  /** A folder may carry auth its descendants inherit. */
  auth?: PostmanAuth
}

export interface PostmanCollection {
  info?: { name?: string; schema?: string }
  item?: PostmanItem[]
  auth?: PostmanAuth
  variable?: PostmanKeyValue[]
}

/**
 * Is this a Postman v2 collection?
 *
 * A REGEX, not a list of exact URLs (two hosts × two versions, because Postman changed domains).
 * A list is a silent trip-wire: a `v2.1.0` schema URL spelled any other way — a trailing space, a
 * new host, a future `v2.2` — returns null and the collection reads as "not Postman" with no
 * explanation. Matching the shape says what we actually mean: a v2.x collection.
 */
const SCHEMA_RE = /schema\.(?:get)?postman\.com\/json\/collection\/v2\.\d+/i

export function isPostmanCollection(doc: unknown): doc is PostmanCollection {
  if (!doc || typeof doc !== 'object') return false
  const schema = (doc as PostmanCollection).info?.schema
  return typeof schema === 'string' && SCHEMA_RE.test(schema)
}

/**
 * True when this pair should be SENT.
 *
 * The one place the 2.0/2.1 split actually bites. 2.0 says `enabled`, 2.1 says `disabled`, and
 * computing `disabled = !enabled` would make a 2.0 param that simply omits `enabled` (the common
 * case; Postman's own default is true) import DISABLED and silently stop being sent. Absence
 * means enabled, in both versions.
 */
export function isEnabled(pair: PostmanKeyValue): boolean {
  if (pair.disabled === true) return false
  if (pair.enabled === false) return false
  return true
}

/** A pair's value as a string. Postman puts numbers and nulls here in the wild. */
export function pairValue(pair: PostmanKeyValue): string {
  const { value } = pair
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}
