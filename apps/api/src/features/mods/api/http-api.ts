/**
 * `$.http.fetch`, with Claude Code's limits: http and https only, 30 s, 5 redirects and 4 MiB each
 * way. Redirects are followed here, as a browser's fetch follows them: a cross-origin hop keeps only
 * the harmless headers (no `Authorization` or cookie reaches another origin), a 303 — or a 301/302
 * after a POST — goes on as a GET without its body.
 */
const FETCH_MS = 30_000
const MAX_BODY = 4 * 1024 * 1024
const MAX_REDIRECTS = 5
const SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:'])
/** What a request may carry to an origin it did not name. */
const CROSS_ORIGIN_HEADERS: ReadonlySet<string> = new Set([
  'accept',
  'accept-language',
  'content-type',
  'user-agent',
])
/** The headers that describe a body, dropped with it when a redirect turns the request into a GET. */
const BODY_HEADERS: ReadonlySet<string> = new Set([
  'content-encoding',
  'content-language',
  'content-location',
  'content-type',
  'content-length',
])

export interface HttpInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

interface Hop {
  url: URL
  method: string
  headers: Record<string, string>
  body: string | undefined
}

function httpUrl(raw: string, base?: URL): URL {
  let url: URL
  try {
    url = new URL(raw, base)
  } catch {
    throw new Error(`http.fetch: ${raw} is not a URL`)
  }
  if (!SCHEMES.has(url.protocol))
    throw new Error(`http.fetch: only http and https URLs are fetched, not ${url.protocol}`)
  return url
}

const pick = (headers: Record<string, string>, keep: (name: string) => boolean) =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => keep(name.toLowerCase())))

/** The request a redirect answered with `status` leads to at `location`. */
export function redirectedHop(hop: Hop, status: number, location: string): Hop {
  const url = httpUrl(location, hop.url)
  const toGet =
    (status === 303 && hop.method !== 'HEAD') ||
    ((status === 301 || status === 302) && hop.method === 'POST')
  let headers = toGet ? pick(hop.headers, (name) => !BODY_HEADERS.has(name)) : hop.headers
  if (url.origin !== hop.url.origin)
    headers = pick(headers, (name) => CROSS_ORIGIN_HEADERS.has(name))
  return {
    url,
    method: toGet ? 'GET' : hop.method,
    headers,
    body: toGet ? undefined : hop.body,
  }
}

/**
 * The first `MAX_BODY` bytes of the body as text; the rest is never read — the stream is cancelled
 * once the limit is reached, so a chunked or compressed answer cannot make the process buffer it.
 * A character cut in half at the limit is dropped rather than shown as a replacement mark.
 */
async function cappedText(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let left = MAX_BODY
  try {
    while (left > 0) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()
      const chunk = value.byteLength > left ? value.subarray(0, left) : value
      left -= chunk.byteLength
      text += decoder.decode(chunk, { stream: true })
    }
    return text
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

export async function modFetch(url: string, init: HttpInit = {}, fetcher: typeof fetch = fetch) {
  if (init.body && init.body.length > MAX_BODY) throw new Error('the request body is over 4 MiB')
  const signal = AbortSignal.timeout(FETCH_MS)
  let hop: Hop = {
    url: httpUrl(String(url)),
    method: (init.method ?? 'GET').toUpperCase(),
    headers: { ...init.headers },
    body: init.body,
  }
  for (let hops = 0; ; hops++) {
    const response = await fetcher(hop.url.href, {
      method: hop.method,
      headers: hop.headers,
      ...(hop.body === undefined ? {} : { body: hop.body }),
      redirect: 'manual',
      signal,
    })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      if (hops >= MAX_REDIRECTS) throw new Error(`more than ${MAX_REDIRECTS} redirects`)
      if (response.body) await response.body.cancel().catch(() => undefined)
      hop = redirectedHop(hop, response.status, location)
      continue
    }
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > MAX_BODY && hop.method !== 'HEAD')
      throw new Error(`the response is over the ${MAX_BODY}-byte limit`)
    const text = await cappedText(response)
    return {
      status: response.status,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
      text,
    }
  }
}
