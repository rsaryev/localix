/**
 * HAR 1.2 (HTTP Archive) → RequestSpec.
 *
 * A HAR is what a browser's network tab exports, so this imports a whole recorded session at once
 * — the bulk counterpart to pasting one curl command.
 *
 * HAR has no notion of auth, so every request imports with `auth: none`. An `Authorization` header
 * is left verbatim rather than sniffed: unlike a curl command (which a person wrote and can fix),
 * a HAR is a machine recording of a real session, and its header may be a short-lived token whose
 * scheme we'd only be guessing at.
 */

import type { Pair, RequestBody, RequestSpec } from '../request-spec'
import { parseMethod } from '../request-spec'
import { suggestName } from './curl'
import type { ImportedRequest, Importer } from './types'

/** The slice of the HAR schema we read. Everything else in the archive is response/timing data. */
interface HarNameValue {
  name: string
  value?: string
}
interface HarPostData {
  mimeType?: string
  text?: string
  params?: { name: string; value?: string; fileName?: string }[]
}
interface HarRequest {
  method?: string
  url?: string
  headers?: HarNameValue[]
  queryString?: HarNameValue[]
  cookies?: HarNameValue[]
  postData?: HarPostData
  comment?: string
}
interface HarLog {
  log?: { entries?: { request?: HarRequest; comment?: string }[] }
}

const pairs = (entries: HarNameValue[] | undefined): Pair[] =>
  (entries ?? []).map(({ name, value }) => ({ name, value: value ?? '' }))

function importPostData(postData: HarPostData | undefined): RequestBody | undefined {
  if (!postData) return undefined
  const { params, mimeType, text } = postData
  if (params?.length) {
    return {
      mimeType: mimeType || 'application/x-www-form-urlencoded',
      // A file part records only its filename in a HAR; the bytes were never archived, so the
      // field imports naming the file rather than pretending to carry it.
      form: params.map(({ name, value, fileName }) => ({ name, value: value ?? fileName ?? '' })),
    }
  }
  if (!text) return undefined
  return { mimeType, text }
}

/** `cookies[]` are a parsed view of the Cookie header; fold them back into one. */
function applyCookies(request: HarRequest, headers: Pair[]): Pair[] {
  const cookies = (request.cookies ?? []).map(({ name, value }) => `${name}=${value ?? ''}`)
  if (cookies.length === 0) return headers
  const value = cookies.join('; ')
  const existing = headers.find((h) => h.name.toLowerCase() === 'cookie')
  if (!existing) return [...headers, { name: 'Cookie', value }]
  // The header already carries them — a HAR lists both views of the same cookies, so appending
  // would send every cookie twice.
  return headers
}

function importRequest(request: HarRequest, comment: string | undefined): ImportedRequest | null {
  const url = request.url
  if (!url) return null
  const headers = applyCookies(request, pairs(request.headers))
  const query = pairs(request.queryString)
  const spec: RequestSpec = {
    // Strip the querystring ONLY when `queryString[]` actually replaced it. A HAR entry may carry a
    // raw `?q=cats` and no `queryString[]` at all — stripping unconditionally loses it and puts
    // nothing back. (The same trap `import/postman/url.ts` guards against; it was fixed there and
    // left here, one directory over, until a review noticed.)
    url: query.length > 0 ? url.split('?')[0] : url,
    method: parseMethod(request.method) ?? 'GET',
    headers,
    query,
    body: importPostData(request.postData),
    auth: { type: 'none' },
  }
  return { name: comment?.trim() || request.comment?.trim() || suggestName(url), spec }
}

export function convertHar(text: string): ImportedRequest[] | null {
  let data: HarLog
  try {
    data = JSON.parse(text) as HarLog
  } catch {
    return null // not JSON — not ours
  }
  const entries = data?.log?.entries
  if (!Array.isArray(entries)) return null // JSON, but not a HAR
  return entries
    .map((entry) => (entry?.request ? importRequest(entry.request, entry.comment) : null))
    .filter((r): r is ImportedRequest => r !== null)
}

export const harImporter: Importer = {
  id: 'har',
  name: 'HAR 1.2 archive',
  convert: convertHar,
}
