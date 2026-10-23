import type { Pair, RequestAuth, RequestBody } from '../request-spec'
import type { InsoPair, InsoResource } from './insomnia-types'

/**
 * `{{ _.base_url }}` → `{{base_url}}`.
 *
 * Only the `_.` namespace and the bracket form Insomnia rewrites hyphenated names into
 * (`{{ _['my-var'] }}`) — everything else is left exactly as written. A `{% tag %}` is NOT
 * translated: those belong to Insomnia's template engine (faker, response-chaining, prompts), and
 * inventing a value without that engine would be worse than leaving the tag visible.
 */
export function normaliseTemplating(text: string): string {
  if (!text.includes('{{')) return text
  return text.replace(
    /\{\{\s*_(?:\.([A-Za-z0-9_$]+)|\[['"]([^'"]+)['"]\])\s*\}\}/g,
    (_m, dotted, bracketed) => `{{${dotted ?? bracketed}}}`,
  )
}

export const insomniaText = (v: string | undefined | null): string => normaliseTemplating(v ?? '')

export function insomniaPairs(list: InsoPair[] | undefined): Pair[] {
  const out: Pair[] = []
  for (const pair of list ?? []) {
    if (typeof pair.name !== 'string' || pair.name === '') continue
    out.push({
      name: insomniaText(pair.name),
      value: insomniaText(pair.value),
      ...(pair.disabled ? { disabled: true } : {}),
    })
  }
  return out
}

/**
 * Insomnia auth fields → the local auth union.
 *
 * `disabled: true` means the auth block exists but is switched off — it is NOT inheritance, so it
 * resolves to none rather than falling through to the parent.
 */
export function convertAuth(auth: Record<string, unknown> | undefined): {
  auth: RequestAuth | null
  unsupported: string | null
} {
  const type = typeof auth?.type === 'string' ? auth.type.toLowerCase() : undefined
  // `{}` — the shape Insomnia writes for "inherit from my parent".
  if (!auth || !type) return { auth: null, unsupported: null }
  if (auth.disabled === true || type === 'none')
    return { auth: { type: 'none' }, unsupported: null }

  const str = (k: string) => (typeof auth[k] === 'string' ? (auth[k] as string) : '')
  switch (type) {
    case 'bearer': {
      const token = insomniaText(str('token'))
      return token
        ? { auth: { type: 'bearer', token }, unsupported: null }
        : { auth: null, unsupported: null }
    }
    case 'basic':
      return {
        auth: {
          type: 'basic',
          username: insomniaText(str('username')),
          password: insomniaText(str('password')),
        },
        unsupported: null,
      }
    case 'apikey': {
      const key = insomniaText(str('key'))
      if (!key) return { auth: null, unsupported: null }
      const addTo = str('addTo').toLowerCase()
      return {
        auth: {
          type: 'apikey',
          key,
          value: insomniaText(str('value')),
          addTo: addTo === 'query' ? 'query' : addTo === 'cookie' ? 'cookie' : 'header',
        },
        unsupported: null,
      }
    }
    default:
      // oauth1/oauth2/digest/ntlm/awsIam/hawk/asap/netrc — named in their model, unsignable by us.
      return { auth: null, unsupported: type }
  }
}

export function convertInsomniaBody(body: InsoResource['body']): RequestBody | undefined {
  // v2 wrote a bare string; v3+ writes the object expected by the local request model.
  if (typeof body === 'string') return body === '' ? undefined : { text: normaliseTemplating(body) }
  if (!body) return undefined
  const mimeType = body.mimeType ?? undefined
  if (body.params?.length) return { mimeType, form: insomniaPairs(body.params) }
  if (!body.text) return undefined
  return { mimeType, text: normaliseTemplating(body.text) }
}

/**
 * Header names that carry one value. Everything else accumulates — see `inheritHeaders`.
 */
const SINGLE_VALUE_HEADERS = [
  'proxy-authorization',
  'content-length',
  'content-type',
  'content-encoding',
  'content-location',
  'connection',
  'host',
  'upgrade',
  'range',
  'trailer',
]

/**
 * HEADERS INHERIT THROUGH `parentId` TOO — and they do not merely override.
 *
 * Header inheritance must be materialized alongside auth inheritance. Otherwise a header set once
 * on a request group silently disappears from every imported child request.
 *
 * The merge follows HTTP field semantics:
 *   - outermost folder first, then inner folders, then the request itself — nearest wins;
 *   - a SINGLE_VALUE header is REPLACED (two `Content-Type`s is not a thing);
 *   - any other header ACCUMULATES, comma-joined, which is how HTTP spells a repeated header on
 *     one line. That matters here beyond fidelity: our send path (`toHeaderInit`) is a
 *     `Record<string, string>`, so it can only carry one value per name — comma-joining is not a
 *     stylistic choice, it is the only way a repeated `Accept` survives us at all;
 *   - a disabled or blank-named header contributes nothing TO THE MERGE;
 *   - the casing of the LAST writer wins.
 *
 * THE MERGE IS SEND-TIME LOGIC, AND THIS IS IMPORT. That distinction is the whole reason `own` is
 * a separate parameter rather than just the last context. Wire construction discards disabled
 * headers, but importing stores them as saved-but-off (`activePairs` drops them at send time).
 * Ancestors and the request's enabled headers merge; the request's disabled headers pass through
 * untouched.
 */
export function inheritHeaders(
  ancestors: readonly (InsoPair[] | undefined)[],
  own: InsoPair[] | undefined,
): Pair[] {
  const values = new Map<string, string>()
  const casing = new Map<string, string>()
  for (const { name, value, disabled } of [...ancestors, own].flatMap((h) => h ?? [])) {
    if (disabled || !name?.trim()) continue
    const key = name.toLowerCase()
    casing.set(key, name)
    const merged =
      SINGLE_VALUE_HEADERS.includes(key) || !values.has(key)
        ? insomniaText(value)
        : `${values.get(key)}, ${insomniaText(value)}`
    values.set(key, merged)
  }
  const merged: Pair[] = [...values].map(([key, value]) => ({ name: casing.get(key)!, value }))
  // The request's own switched-off headers, preserved as the user left them.
  const off: Pair[] = []
  for (const pair of own ?? []) {
    if (pair.disabled && pair.name?.trim()) {
      off.push({ name: insomniaText(pair.name), value: insomniaText(pair.value), disabled: true })
    }
  }
  return [...merged, ...off]
}
