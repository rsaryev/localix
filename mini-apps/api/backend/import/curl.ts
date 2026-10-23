/**
 * cURL command → RequestSpec. The SEMANTIC half: what each collected flag means. The mechanical
 * half (what is a flag, what is its value) is `curl-parse.ts`.
 *
 * This is the highest-value importer for an agent: a REST API's documentation almost always shows
 * a curl command, and a browser's "Copy as cURL" turns any request in a devtools network tab into
 * one. Pasting that beats re-typing headers by hand.
 *
 * Auth is sniffed: an `Authorization: Bearer x` header becomes real bearer auth, not a raw header,
 * so it can be swapped for a `${secret:KEY}` reference afterwards.
 */

import type { Pair, RequestAuth, RequestBody, RequestSpec } from '../request-spec'
import { bodyIsForm, parseMethod } from '../request-spec'
import { DATA_FLAGS } from './curl-flags'
import { flagPresent, flagValue, flagValues, looksLikeCurl, parseCurl } from './curl-parse'
import type { ImportedRequest, Importer } from './types'

/** Split on the FIRST colon only — a header value may itself contain colons (a url, a time). */
function splitOnce(raw: string, sep: string): [string, string] {
  const at = raw.indexOf(sep)
  if (at === -1) return [raw, '']
  return [raw.slice(0, at), raw.slice(at + sep.length)]
}

function headerPairs(flags: ReturnType<typeof parseCurl>['flags']): Pair[] {
  const headers: Pair[] = []
  for (const header of flagValues(flags, ['H', 'header'])) {
    if (!header.includes(':')) continue
    const [name, value] = splitOnce(header, ':')
    // `-H 'X-Trace;'` is curl's way of sending a header with an empty value.
    headers.push({ name: name.trim().replace(/;$/, ''), value: value.trim() })
  }
  return headers
}

/**
 * Pull auth out of the headers rather than leaving it as one. A recognised scheme becomes real
 * auth so it can later be re-pointed at the vault; an unrecognised `Authorization` header is left
 * alone, because guessing at a scheme we can't sign would lose the header entirely.
 */
function extractAuth(
  flags: ReturnType<typeof parseCurl>['flags'],
  headers: Pair[],
): {
  auth: RequestAuth
  headers: Pair[]
} {
  const authHeader = headers.find((h) => h.name.toLowerCase() === 'authorization')
  if (authHeader) {
    const rest = headers.filter((h) => h !== authHeader)
    const [scheme, token] = splitOnce(authHeader.value.trim(), ' ')
    if (scheme.toLowerCase() === 'bearer' && token.trim()) {
      return { auth: { type: 'bearer', token: token.trim() }, headers: rest }
    }
    if (scheme.toLowerCase() === 'basic' && token.trim()) {
      try {
        const [username, password] = splitOnce(
          Buffer.from(token.trim(), 'base64').toString('utf8'),
          ':',
        )
        if (username) return { auth: { type: 'basic', username, password }, headers: rest }
      } catch {
        // Not valid base64 — fall through and keep the header verbatim.
      }
    }
    return { auth: { type: 'none' }, headers } // a scheme we don't sign: keep it as a header
  }

  // `--oauth2-bearer TOKEN` is curl's own spelling of a bearer token — it sends exactly
  // `Authorization: Bearer TOKEN`. It used to sit in IGNORED_VALUE_FLAGS, so the token was
  // consumed and thrown away: the request imported unauthenticated, with nothing said.
  const oauthBearer = flagValue(flags, ['oauth2-bearer'])
  if (oauthBearer) return { auth: { type: 'bearer', token: oauthBearer }, headers }

  const userFlag = flagValue(flags, ['u', 'user'])
  if (userFlag) {
    const [username, password] = splitOnce(userFlag, ':')
    return { auth: { type: 'basic', username: username.trim(), password }, headers }
  }
  return { auth: { type: 'none' }, headers }
}

/** `-b name=value` / `--cookie` become a Cookie header, merged with any explicit one. */
function applyCookies(flags: ReturnType<typeof parseCurl>['flags'], headers: Pair[]): Pair[] {
  const cookies = flagValues(flags, ['b', 'cookie']).filter((c) => c.includes('='))
  if (cookies.length === 0) return headers
  const value = cookies.join('; ')
  const existing = headers.find((h) => h.name.toLowerCase() === 'cookie')
  if (!existing) return [...headers, { name: 'Cookie', value }]
  return headers.map((h) => (h === existing ? { ...h, value: `${h.value}; ${value}` } : h))
}

/** Every `-d`/`--data*` value, with `--data-urlencode` encoded as curl would. */
function dataStrings(flags: ReturnType<typeof parseCurl>['flags']): string[] {
  const out: string[] = []
  for (const flag of DATA_FLAGS) {
    for (const raw of flagValues(flags, [flag])) {
      if (flag !== 'data-urlencode') {
        out.push(raw)
        continue
      }
      // `--data-urlencode name=value` encodes only the value; a bare `value` encodes whole.
      const [name, value] = splitOnce(raw, '=')
      out.push(raw.includes('=') ? `${name}=${encodeURIComponent(value)}` : encodeURIComponent(raw))
    }
  }
  return out
}

function parsePairsFromQueryString(raw: string): Pair[] {
  const out: Pair[] = []
  for (const chunk of raw.split('&')) {
    if (chunk === '') continue
    const [name, value] = splitOnce(chunk, '=')
    out.push({ name: decodeURIComponent(name), value: decodeURIComponent(value) })
  }
  return out
}

function contentTypeOf(headers: Pair[]): string | undefined {
  return headers.find((h) => h.name.toLowerCase() === 'content-type')?.value
}

/** `-F name=value` / `-F name=@file`. A file upload is imported as a field naming the file. */
function formPairs(flags: ReturnType<typeof parseCurl>['flags']): Pair[] {
  return flagValues(flags, ['F', 'form']).map((raw) => {
    const [name, value] = splitOnce(raw, '=')
    return { name, value }
  })
}

function buildBody(data: string[], form: Pair[], headers: Pair[]): RequestBody | undefined {
  const mimeType = contentTypeOf(headers)
  if (form.length > 0) return { mimeType: mimeType ?? 'multipart/form-data', form }
  if (data.length === 0) return undefined
  const text = data.join('&')
  if (bodyIsForm({ mimeType })) {
    return { mimeType: mimeType!, form: parsePairsFromQueryString(text) }
  }
  // No Content-Type given: curl itself defaults `-d` to form-urlencoded, and so do we — guessing
  // JSON from a `{`-shaped body would send a Content-Type the server never agreed to.
  return { mimeType: mimeType ?? 'application/x-www-form-urlencoded', text }
}

function splitUrl(raw: string): { url: string; query: Pair[] } {
  try {
    const parsed = new URL(raw)
    const query: Pair[] = [...parsed.searchParams.entries()].map(([name, value]) => ({
      name,
      value,
    }))
    parsed.search = ''
    return { url: parsed.toString().replace(/\?$/, ''), query }
  } catch {
    return { url: raw, query: [] }
  }
}

/** A short, stable name from the url's path — `github-users` for `.../users`. */
export function suggestName(url: string): string {
  try {
    const { hostname, pathname } = new URL(url)
    const segments = pathname.split('/').filter((s) => s !== '' && !s.startsWith(':'))
    const tail = segments.slice(-2).join('-')
    const host = hostname.replace(/^www\./, '').split('.')[0]
    const name = [host, tail].filter(Boolean).join('-')
    // @safe-file-key-exemption rule -- Slugs an editable JSON display name, never a filesystem key.
    return name.replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase() || 'imported-request'
  } catch {
    return 'imported-request'
  }
}

/**
 * `-X` wins outright; otherwise curl's own defaulting: `-I` is HEAD, a body implies POST, and
 * everything else is GET.
 */
function resolveMethod(
  flags: ReturnType<typeof parseCurl>['flags'],
  body: RequestBody | undefined,
) {
  const explicit = parseMethod(flagValue(flags, ['X', 'request']))
  if (explicit) return explicit
  if (flagPresent(flags, ['I', 'head'])) return 'HEAD'
  return body ? 'POST' : 'GET'
}

export function convertCurl(text: string): ImportedRequest[] | null {
  if (!looksLikeCurl(text)) return null

  const { flags, bare } = parseCurl(text)
  const rawUrl = flagValue(flags, ['url']) ?? bare[0]
  if (!rawUrl) return null

  const { url, query } = splitUrl(rawUrl)
  let headers = headerPairs(flags)
  headers = applyCookies(flags, headers)
  const extracted = extractAuth(flags, headers)
  headers = extracted.headers

  if (
    flagPresent(flags, ['compressed']) &&
    !headers.some((h) => h.name.toLowerCase() === 'accept-encoding')
  ) {
    headers.push({ name: 'Accept-Encoding', value: 'deflate, gzip' })
  }

  const data = dataStrings(flags)
  const form = formPairs(flags)

  // `-G` moves the data onto the query string instead of the body — the one flag that changes
  // where `-d` lands, so it is resolved before the body is built.
  const asQuery = flagPresent(flags, ['G', 'get'])
  const body = asQuery ? undefined : buildBody(data, form, headers)
  const allQuery = asQuery ? [...query, ...data.flatMap(parsePairsFromQueryString)] : query

  const spec: RequestSpec = {
    url,
    method: resolveMethod(flags, body),
    headers,
    query: allQuery,
    body,
    auth: extracted.auth,
    // curl does NOT follow redirects unless told to. Importing that faithfully matters: a command
    // copied from docs behaves here the way it behaves in a terminal.
    followRedirects: flagPresent(flags, ['L', 'location']),
  }
  return [{ name: suggestName(url), spec }]
}

export const curlImporter: Importer = {
  id: 'curl',
  name: 'cURL command',
  convert: convertCurl,
}
