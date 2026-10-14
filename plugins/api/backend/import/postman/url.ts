/**
 * Postman's `url` → our url + query + path parameters.
 *
 * `url` is a string OR an object, and the object is redundant with itself: `raw` holds the whole
 * thing while `protocol`/`host[]`/`path[]`/`query[]` hold it again, parsed. Taking `raw` and never
 * reassembling the parts would lose the url ENTIRELY for an object that has parts and no `raw`, a
 * shape Postman really does emit. We prefer `raw` (it is what the author typed, and it preserves
 * `{{variables}}` verbatim) but fall back to rebuilding rather than to `''`.
 */

import type { Pair } from '../../request-spec'
import { isEnabled, pairValue, type PostmanUrl } from './types'

const asArray = (v: string[] | string | undefined): string[] =>
  Array.isArray(v) ? v : typeof v === 'string' && v !== '' ? [v] : []

/** Rebuild `https://host/a/b` from the structured parts. */
function fromParts(url: PostmanUrl): string {
  const host = asArray(url.host).join('.')
  if (!host) return ''
  const protocol = url.protocol || 'https'
  const port = url.port ? `:${url.port}` : ''
  const segments = asArray(url.path).filter((s) => s !== '')
  const path = segments.length > 0 ? `/${segments.join('/')}` : ''
  return `${protocol}://${host}${port}${path}`
}

/** Everything before the `?`. */
function withoutQuery(raw: string): string {
  const at = raw.indexOf('?')
  return at === -1 ? raw : raw.slice(0, at)
}

export interface ConvertedUrl {
  url: string
  query: Pair[]
  pathParameters: Pair[]
}

export function convertUrl(raw: PostmanUrl | string | undefined): ConvertedUrl {
  if (typeof raw === 'string') return { url: raw, query: [], pathParameters: [] }
  if (!raw) return { url: '', query: [], pathParameters: [] }

  const query: Pair[] = []
  for (const parameter of raw.query ?? []) {
    if (typeof parameter.key !== 'string' || parameter.key === '') continue
    query.push({
      name: parameter.key,
      value: pairValue(parameter),
      ...(isEnabled(parameter) ? {} : { disabled: true }),
    })
  }

  // `/:id` → our `:id` is already the same token, so the url text needs no rewrite — only the
  // values come across. Postman leaves these empty far more often than not.
  const pathParameters: Pair[] = []
  for (const variable of raw.variable ?? []) {
    if (typeof variable.key === 'string' && variable.key !== '') {
      pathParameters.push({ name: variable.key, value: pairValue(variable) })
    }
  }

  const base = raw.raw && raw.raw !== '' ? raw.raw : fromParts(raw)
  // Strip the querystring ONLY when we actually took params out of `query[]`, or they are sent
  // twice. Stripping whenever `url.query` is truthy would be wrong — `[]` is truthy — a collection
  // with an empty query array would lose its raw querystring for nothing.
  const url = query.length > 0 ? withoutQuery(base) : base

  return { url, query, pathParameters }
}
