/**
 * Token-free research discovery adapters.
 *
 * This module owns provider wire formats only. The public `Research` tool owns
 * query planning, adapter selection, consensus ranking, safe page reads and the
 * final evidence packet. Every adapter therefore normalizes into the same small
 * result shape and can fail without taking the other adapters down.
 *
 * General web discovery deliberately uses a three-step DuckDuckGo cascade
 * (d.js → HTML → Lite), so a blocked or changed endpoint can fall through
 * without disabling token-free search. Every branch uses the injected fetch,
 * byte caps and DOM stack. Structured verticals are public endpoints that
 * require no API token.
 */
import { sleep } from '@localixai/agent/backoff'
import { DOMParser, parseHTML } from 'linkedom'

import { decodeEntities, stripToText } from './html-text'
import { readBodyCapped, type HttpFetch } from '@localixai/mini-app-sdk/backend'

/** Provider-neutral lanes exposed to the model instead of provider names. */
export type ResearchSourceType = 'web' | 'academic' | 'code' | 'community' | 'encyclopedia'

export type ResearchBackend =
  | 'duckduckgo'
  | 'brave'
  | 'bing'
  | 'wikipedia'
  | 'arxiv'
  | 'crossref'
  | 'github'
  | 'hackernews'
  | 'stackexchange'

/** One ranked hit, in the shape every backend normalizes to. */
export interface ResearchSearchHit {
  title: string
  /** Canonical URL shown and cited. */
  url: string
  snippet: string
  /**
   * Optional machine-readable resource used to load evidence. This lets an
   * adapter read bounded API metadata while still citing the canonical DOI/page.
   */
  readUrl?: string
  publishedAt?: string
  sourceType: ResearchSourceType
}

/** Provider-neutral search parameters accepted by every adapter. */
export interface ResearchSearchRequest {
  query: string
  count: number
  includeDomains: string[]
  excludeDomains: string[]
  recencyDays?: number
}

/** Everything a backend needs from the caller to run one search. */
export interface SearchContext {
  doFetch: HttpFetch
  userAgent: string
  maxResponseBytes: number
  signal?: AbortSignal
}

export interface SearchBackendResult {
  hits: ResearchSearchHit[]
  /** Concrete endpoint/cascade branch used, for diagnostics only. */
  strategy?: string
  /** Provider-requested cooldown; the orchestrator skips later queries. */
  cooldownMs?: number
}

export interface SearchBackendSpec {
  label: string
  sourceType: ResearchSourceType
  search(ctx: SearchContext, request: ResearchSearchRequest): Promise<SearchBackendResult>
}

/** An engine failure that should suppress later queries to that engine. */
export class ResearchBackendCooldownError extends Error {
  readonly cooldownMs: number

  constructor(message: string, cooldownMs: number) {
    super(message)
    this.cooldownMs = cooldownMs
    this.name = 'ResearchBackendCooldownError'
  }
}

function queryWithDomainFilters(request: ResearchSearchRequest): string {
  const included =
    request.includeDomains.length > 0
      ? ` (${request.includeDomains.map((domain) => `site:${domain}`).join(' OR ')})`
      : ''
  const excluded = request.excludeDomains.map((domain) => ` -site:${domain}`).join('')
  return `${request.query}${included}${excluded}`
}

function recencyWindow(days: number | undefined): 'd' | 'w' | 'm' | 'y' | undefined {
  if (!days) return undefined
  if (days <= 1) return 'd'
  if (days <= 7) return 'w'
  if (days <= 31) return 'm'
  return 'y'
}

function sinceDate(days: number | undefined): string | undefined {
  if (!days) return undefined
  const date = new Date(Date.now() - days * 86_400_000)
  return date.toISOString().slice(0, 10)
}

function retryAfterMs(response: Response, fallbackMs = 60_000): number {
  const raw = response.headers.get('retry-after')
  if (raw) {
    const seconds = Number(raw)
    if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1_000)
    const date = Date.parse(raw)
    if (Number.isFinite(date)) return Math.max(1_000, date - Date.now())
  }
  const reset = Number(response.headers.get('x-ratelimit-reset'))
  if (Number.isFinite(reset) && reset > 0) return Math.max(1_000, reset * 1_000 - Date.now())
  return fallbackMs
}

async function requestText(
  ctx: SearchContext,
  url: string,
  accept: string,
  headers: Record<string, string> = {},
): Promise<{ response: Response; text: string }> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await ctx.doFetch(url, {
        signal: ctx.signal,
        headers: {
          'User-Agent': ctx.userAgent,
          Accept: accept,
          ...headers,
        },
      })
      if (response.status === 429 || response.status === 403) {
        const cooldownMs = retryAfterMs(response)
        throw new ResearchBackendCooldownError(`HTTP ${response.status}`, cooldownMs)
      }
      if (!response.ok) {
        if (attempt === 0 && (response.status === 408 || response.status >= 500)) {
          await sleep(200 + Math.floor(Math.random() * 100))
          continue
        }
        throw new Error(`HTTP ${response.status}`)
      }
      const body = await readBodyCapped(response, ctx.maxResponseBytes)
      if (body.truncated) {
        throw new Error(`response exceeded ${ctx.maxResponseBytes} bytes`)
      }
      return { response, text: body.text }
    } catch (error) {
      if (error instanceof ResearchBackendCooldownError) throw error
      lastError = error
      if (attempt === 0 && !ctx.signal?.aborted) {
        await sleep(200 + Math.floor(Math.random() * 100))
        continue
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function requestJson<T>(
  ctx: SearchContext,
  url: string,
  headers?: Record<string, string>,
): Promise<{ response: Response; data: T }> {
  const { response, text } = await requestText(ctx, url, 'application/json', headers)
  try {
    return { response, data: JSON.parse(text) as T }
  } catch {
    throw new Error('invalid JSON response')
  }
}

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

/** Bing wraps organic targets in `/ck/a?...&u=a1<base64url>`. */
function unwrapBingUrl(value: unknown): string | null {
  const direct = validHttpUrl(value)
  if (!direct) return null
  try {
    const parsed = new URL(direct)
    const isBingRedirect =
      (parsed.hostname === 'bing.com' || parsed.hostname.endsWith('.bing.com')) &&
      parsed.pathname.startsWith('/ck/')
    if (!isBingRedirect) return direct
    const encoded = parsed.searchParams.get('u')
    if (!encoded?.startsWith('a1')) return direct
    const decoded = Buffer.from(encoded.slice(2), 'base64url').toString('utf8')
    return validHttpUrl(decoded) ?? direct
  } catch {
    return direct
  }
}

/** DuckDuckGo wraps result links as //duckduckgo.com/l/?uddg=<encoded-url>. */
function unwrapDdgUrl(href: string): string | null {
  try {
    const parsed = new URL(href, 'https://duckduckgo.com')
    const wrapped = parsed.searchParams.get('uddg')
    const url = wrapped ? decodeURIComponent(wrapped) : parsed.href
    const valid = validHttpUrl(url)
    if (!valid) return null
    const hostname = new URL(valid).hostname
    return hostname === 'duckduckgo.com' || hostname.endsWith('.duckduckgo.com') ? null : valid
  } catch {
    return null
  }
}

function normalizeWhitespace(value: string): string {
  return decodeEntities(value).replace(/\s+/g, ' ').trim()
}

function parseDdgDocument(html: string, count: number): ResearchSearchHit[] {
  const { document } = parseHTML(html)
  const anchors = document.querySelectorAll('a')
  const seen = new Set<string>()
  const hits: ResearchSearchHit[] = []

  for (const anchor of anchors) {
    if (hits.length >= count) break
    const url = unwrapDdgUrl(anchor.getAttribute('href') ?? '')
    if (!url || seen.has(url)) continue
    const title = normalizeWhitespace(anchor.textContent ?? '')
    if (!title) continue

    const resultRoot =
      anchor.closest('.result') ??
      anchor.closest('.web-result') ??
      anchor.parentElement?.parentElement ??
      anchor.parentElement
    const explicitSnippet =
      resultRoot?.querySelector('.result__snippet')?.textContent ??
      resultRoot?.querySelector('.result-snippet')?.textContent ??
      ''
    const containerText = normalizeWhitespace(explicitSnippet || resultRoot?.textContent || '')
    const snippet = normalizeWhitespace(containerText.replace(title, '')).slice(0, 500)

    seen.add(url)
    hits.push({ title, url, snippet, sourceType: 'web' })
  }
  return hits
}

async function searchDdgJs(
  ctx: SearchContext,
  request: ResearchSearchRequest,
): Promise<ResearchSearchHit[]> {
  const query = queryWithDomainFilters(request)
  const home = await requestText(
    ctx,
    `https://duckduckgo.com/?${new URLSearchParams({ q: query, ia: 'web' })}`,
    'text/html',
  )
  const vqd = home.text.match(/vqd=['"](\d+-\d+(?:-\d+)?)['"]/)?.[1]
  if (!vqd) throw new Error('VQD token not found')

  const params = new URLSearchParams({
    q: query,
    t: 'D',
    l: 'en-us',
    kl: 'wt-wt',
    s: '0',
    dl: 'en',
    ct: 'US',
    bing_market: 'en-US',
    vqd,
    ex: '-1',
    sp: '1',
    bpa: '1',
  })
  const window = recencyWindow(request.recencyDays)
  if (window) params.set('df', window)
  const body = await requestText(ctx, `https://links.duckduckgo.com/d.js?${params}`, '*/*')
  if (body.text.includes('DDG.deep.anomalyDetectionBlock')) {
    throw new Error('DuckDuckGo anomaly detection')
  }
  if (body.text.includes('DDG.deep.is506')) throw new Error('DuckDuckGo server error')

  const payload = body.text.match(/DDG\.pageLayout\.load\('d',(\[[\s\S]+?\])\);DDG\.duckbar\./)?.[1]
  if (!payload) throw new Error('DuckDuckGo result payload not found')
  const records = JSON.parse(payload.replace(/\t/g, '    ')) as Array<{
    u?: unknown
    t?: unknown
    a?: unknown
    n?: unknown
  }>
  const hits: ResearchSearchHit[] = []
  for (const record of records) {
    if (hits.length >= request.count) break
    if (record.n !== undefined) continue
    const url = validHttpUrl(record.u)
    const title = typeof record.t === 'string' ? stripToText(record.t) : ''
    if (!url || !title) continue
    hits.push({
      title,
      url,
      snippet: typeof record.a === 'string' ? stripToText(record.a) : '',
      sourceType: 'web',
    })
  }
  if (hits.length === 0) throw new Error('no results in DuckDuckGo payload')
  return hits
}

async function searchDdgHtmlVariant(
  ctx: SearchContext,
  request: ResearchSearchRequest,
  variant: 'html' | 'lite',
): Promise<ResearchSearchHit[]> {
  const query = queryWithDomainFilters(request)
  const params = new URLSearchParams({ q: query, kl: 'wt-wt' })
  const window = recencyWindow(request.recencyDays)
  if (window) params.set('df', window)
  const url =
    variant === 'html'
      ? `https://html.duckduckgo.com/html/?${params}`
      : `https://lite.duckduckgo.com/lite/?${params}`
  const { text } = await requestText(ctx, url, 'text/html')
  const hits = parseDdgDocument(text, request.count)
  if (hits.length === 0) throw new Error(`no results parsed from DuckDuckGo ${variant}`)
  return hits
}

async function searchDuckDuckGo(
  ctx: SearchContext,
  request: ResearchSearchRequest,
): Promise<SearchBackendResult> {
  const failures: string[] = []
  let cooldownMs = 0
  const attempts = [
    ['d.js', () => searchDdgJs(ctx, request)],
    ['html', () => searchDdgHtmlVariant(ctx, request, 'html')],
    ['lite', () => searchDdgHtmlVariant(ctx, request, 'lite')],
  ] as const

  for (const [strategy, run] of attempts) {
    try {
      return { hits: await run(), strategy }
    } catch (error) {
      if (error instanceof ResearchBackendCooldownError) {
        cooldownMs = Math.max(cooldownMs, error.cooldownMs)
        failures.push(`${strategy}: ${error.message}`)
        continue
      }
      failures.push(`${strategy}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (cooldownMs > 0) {
    throw new ResearchBackendCooldownError(
      `all DuckDuckGo strategies were rate-limited (${failures.join('; ')})`,
      cooldownMs,
    )
  }
  throw new Error(`all DuckDuckGo strategies failed (${failures.join('; ')})`)
}

async function searchBing(
  ctx: SearchContext,
  request: ResearchSearchRequest,
): Promise<SearchBackendResult> {
  const params = new URLSearchParams({
    q: queryWithDomainFilters(request),
    count: String(request.count),
  })
  const window = recencyWindow(request.recencyDays)
  if (window) params.set('filters', `ex1:"ez${window}"`)
  const { text } = await requestText(ctx, `https://www.bing.com/search?${params}`, 'text/html')
  const { document } = parseHTML(text)
  const hits: ResearchSearchHit[] = []
  for (const block of document.querySelectorAll('li.b_algo')) {
    if (hits.length >= request.count) break
    const anchor = block.querySelector('h2 a')
    const url = unwrapBingUrl(anchor?.getAttribute('href'))
    const title = normalizeWhitespace(anchor?.textContent ?? '')
    if (!url || !title) continue
    hits.push({
      title,
      url,
      snippet: normalizeWhitespace(block.querySelector('p')?.textContent ?? ''),
      sourceType: 'web',
    })
  }
  if (hits.length === 0) throw new Error('no results parsed from Bing')
  return { hits, strategy: 'html' }
}

async function searchBrave(
  ctx: SearchContext,
  request: ResearchSearchRequest,
): Promise<SearchBackendResult> {
  const params = new URLSearchParams({
    q: queryWithDomainFilters(request),
    source: 'web',
  })
  const window = recencyWindow(request.recencyDays)
  if (window) params.set('tf', { d: 'pd', w: 'pw', m: 'pm', y: 'py' }[window])
  const { text } = await requestText(ctx, `https://search.brave.com/search?${params}`, 'text/html')
  const { document } = parseHTML(text)
  const hits: ResearchSearchHit[] = []
  const seen = new Set<string>()
  for (const block of document.querySelectorAll('div[data-type="web"]')) {
    if (hits.length >= request.count) break
    const anchor = block.querySelector('a[href]')
    const url = validHttpUrl(anchor?.getAttribute('href'))
    const title = normalizeWhitespace(
      block.querySelector('.search-snippet-title')?.textContent ??
        anchor?.querySelector('.title')?.textContent ??
        '',
    )
    if (!url || !title || seen.has(url)) continue
    const hostname = new URL(url).hostname
    if (hostname === 'search.brave.com' || hostname.endsWith('.search.brave.com')) continue
    seen.add(url)
    hits.push({
      title,
      url,
      snippet: normalizeWhitespace(block.querySelector('.content')?.textContent ?? ''),
      sourceType: 'web',
    })
  }
  if (hits.length === 0) throw new Error('no results parsed from Brave')
  return { hits, strategy: 'html' }
}

async function searchWikipedia(
  ctx: SearchContext,
  request: ResearchSearchRequest,
): Promise<SearchBackendResult> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: request.query,
    srlimit: String(request.count),
    format: 'json',
    origin: '*',
  })
  const { data } = await requestJson<{
    query?: {
      search?: Array<{ title?: string; snippet?: string; timestamp?: string }>
    }
  }>(ctx, `https://en.wikipedia.org/w/api.php?${params}`)
  const hits = (data.query?.search ?? []).slice(0, request.count).flatMap((result) => {
    const title = result.title?.trim()
    if (!title) return []
    return [
      {
        title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        snippet: stripToText(result.snippet ?? ''),
        ...(result.timestamp ? { publishedAt: result.timestamp } : {}),
        sourceType: 'encyclopedia' as const,
      },
    ]
  })
  return { hits, strategy: 'mediawiki' }
}

function xmlText(element: Element, tag: string): string {
  return normalizeWhitespace(element.getElementsByTagName(tag)[0]?.textContent ?? '')
}

async function searchArxiv(
  ctx: SearchContext,
  request: ResearchSearchRequest,
): Promise<SearchBackendResult> {
  const params = new URLSearchParams({
    search_query: `all:${request.query}`,
    start: '0',
    max_results: String(request.count),
    sortBy: request.recencyDays ? 'submittedDate' : 'relevance',
    sortOrder: 'descending',
  })
  const { text } = await requestText(
    ctx,
    `https://export.arxiv.org/api/query?${params}`,
    'application/atom+xml',
  )
  const document = new DOMParser().parseFromString(text, 'text/xml')
  const hits: ResearchSearchHit[] = []
  for (const entry of document.getElementsByTagName('entry')) {
    if (hits.length >= request.count) break
    const id = xmlText(entry, 'id').replace(/^http:/, 'https:')
    const url = validHttpUrl(id)
    const title = xmlText(entry, 'title')
    if (!url || !title) continue
    hits.push({
      title,
      url,
      snippet: xmlText(entry, 'summary').slice(0, 1_000),
      publishedAt: xmlText(entry, 'published') || undefined,
      sourceType: 'academic',
    })
  }
  return { hits, strategy: 'atom' }
}

function crossrefDate(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const parts = (value as { ['date-parts']?: unknown })['date-parts']
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return undefined
  const [year, month = 1, day = 1] = parts[0] as number[]
  if (!Number.isInteger(year)) return undefined
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

async function searchCrossref(
  ctx: SearchContext,
  request: ResearchSearchRequest,
): Promise<SearchBackendResult> {
  const params = new URLSearchParams({
    'query.bibliographic': request.query,
    rows: String(request.count),
    select: 'DOI,title,abstract,published,URL,author,container-title,type',
  })
  const since = sinceDate(request.recencyDays)
  if (since) params.set('filter', `from-pub-date:${since}`)
  const { data } = await requestJson<{
    message?: {
      items?: Array<{
        DOI?: string
        title?: string[]
        abstract?: string
        published?: unknown
        URL?: string
        author?: Array<{ given?: string; family?: string }>
        ['container-title']?: string[]
      }>
    }
  }>(ctx, `https://api.crossref.org/works?${params}`)

  const hits = (data.message?.items ?? []).slice(0, request.count).flatMap((item) => {
    const title = item.title?.[0]?.trim()
    const doi = item.DOI?.trim()
    const url = validHttpUrl(item.URL) ?? (doi ? `https://doi.org/${doi}` : null)
    if (!title || !url || !doi) return []
    const authors = (item.author ?? [])
      .slice(0, 3)
      .map((author) => [author.given, author.family].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(', ')
    const venue = item['container-title']?.[0]
    const abstract = stripToText(item.abstract ?? '')
    const snippet = [authors, venue, abstract].filter(Boolean).join(' · ').slice(0, 1_000)
    return [
      {
        title,
        url,
        readUrl: `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
        snippet,
        ...(crossrefDate(item.published) ? { publishedAt: crossrefDate(item.published) } : {}),
        sourceType: 'academic' as const,
      },
    ]
  })
  return { hits, strategy: 'rest' }
}

async function searchGitHub(
  ctx: SearchContext,
  request: ResearchSearchRequest,
): Promise<SearchBackendResult> {
  const since = sinceDate(request.recencyDays)
  const query = `${request.query}${since ? ` pushed:>=${since}` : ''}`
  const params = new URLSearchParams({
    q: query,
    per_page: String(request.count),
  })
  const { response, data } = await requestJson<{
    items?: Array<{
      full_name?: string
      html_url?: string
      description?: string | null
      language?: string | null
      stargazers_count?: number
      updated_at?: string
    }>
  }>(ctx, `https://api.github.com/search/repositories?${params}`, {
    'X-GitHub-Api-Version': '2022-11-28',
  })
  const cooldownMs =
    response.headers.get('x-ratelimit-remaining') === '0' ? retryAfterMs(response) : undefined
  const hits = (data.items ?? []).slice(0, request.count).flatMap((item) => {
    const title = item.full_name?.trim()
    const url = validHttpUrl(item.html_url)
    if (!title || !url) return []
    const facts = [
      item.description,
      item.language ? `Language: ${item.language}` : null,
      Number.isFinite(item.stargazers_count) ? `Stars: ${item.stargazers_count}` : null,
    ]
    return [
      {
        title,
        url,
        snippet: facts.filter(Boolean).join(' · ').slice(0, 1_000),
        ...(item.updated_at ? { publishedAt: item.updated_at } : {}),
        sourceType: 'code' as const,
      },
    ]
  })
  return {
    hits,
    strategy: 'repositories',
    ...(cooldownMs ? { cooldownMs } : {}),
  }
}

async function searchHackerNews(
  ctx: SearchContext,
  request: ResearchSearchRequest,
): Promise<SearchBackendResult> {
  const params = new URLSearchParams({
    query: request.query,
    tags: 'story',
    hitsPerPage: String(request.count),
  })
  if (request.recencyDays) {
    const since = Math.floor((Date.now() - request.recencyDays * 86_400_000) / 1_000)
    params.set('numericFilters', `created_at_i>${since}`)
  }
  const endpoint = request.recencyDays ? 'search_by_date' : 'search'
  const { data } = await requestJson<{
    hits?: Array<{
      objectID?: string
      title?: string
      story_title?: string
      url?: string | null
      story_url?: string | null
      story_text?: string | null
      created_at?: string
      points?: number
      num_comments?: number
    }>
  }>(ctx, `https://hn.algolia.com/api/v1/${endpoint}?${params}`)
  const hits = (data.hits ?? []).slice(0, request.count).flatMap((item) => {
    const title = (item.title ?? item.story_title)?.trim()
    const fallback = item.objectID
      ? `https://news.ycombinator.com/item?id=${encodeURIComponent(item.objectID)}`
      : null
    const url = validHttpUrl(item.url ?? item.story_url) ?? fallback
    if (!title || !url) return []
    const snippet = [
      stripToText(item.story_text ?? ''),
      Number.isFinite(item.points) ? `${item.points} points` : null,
      Number.isFinite(item.num_comments) ? `${item.num_comments} comments` : null,
    ]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 1_000)
    return [
      {
        title,
        url,
        snippet,
        ...(item.created_at ? { publishedAt: item.created_at } : {}),
        sourceType: 'community' as const,
      },
    ]
  })
  return { hits, strategy: endpoint }
}

async function searchStackExchange(
  ctx: SearchContext,
  request: ResearchSearchRequest,
): Promise<SearchBackendResult> {
  const params = new URLSearchParams({
    q: request.query,
    site: 'stackoverflow',
    pagesize: String(request.count),
    order: 'desc',
    sort: 'relevance',
  })
  if (request.recencyDays) {
    params.set(
      'fromdate',
      String(Math.floor((Date.now() - request.recencyDays * 86_400_000) / 1_000)),
    )
  }
  const { data } = await requestJson<{
    backoff?: number
    items?: Array<{
      title?: string
      link?: string
      tags?: string[]
      score?: number
      is_answered?: boolean
      creation_date?: number
    }>
  }>(ctx, `https://api.stackexchange.com/2.3/search/advanced?${params}`)
  const hits = (data.items ?? []).slice(0, request.count).flatMap((item) => {
    const title = normalizeWhitespace(item.title ?? '')
    const url = validHttpUrl(item.link)
    if (!title || !url) return []
    const snippet = [
      item.tags?.length ? item.tags.slice(0, 5).join(', ') : null,
      Number.isFinite(item.score) ? `Score: ${item.score}` : null,
      item.is_answered ? 'Answered' : null,
    ]
      .filter(Boolean)
      .join(' · ')
    return [
      {
        title,
        url,
        snippet,
        ...(item.creation_date
          ? { publishedAt: new Date(item.creation_date * 1_000).toISOString() }
          : {}),
        sourceType: 'community' as const,
      },
    ]
  })
  return {
    hits,
    strategy: 'advanced',
    ...(data.backoff ? { cooldownMs: data.backoff * 1_000 } : {}),
  }
}

/** Central adapter registry. Adding a source lane does not change the tool contract. */
export const RESEARCH_BACKENDS: Record<ResearchBackend, SearchBackendSpec> = {
  duckduckgo: {
    label: 'DuckDuckGo',
    sourceType: 'web',
    search: searchDuckDuckGo,
  },
  brave: { label: 'Brave', sourceType: 'web', search: searchBrave },
  bing: { label: 'Bing', sourceType: 'web', search: searchBing },
  wikipedia: {
    label: 'Wikipedia',
    sourceType: 'encyclopedia',
    search: searchWikipedia,
  },
  arxiv: { label: 'arXiv', sourceType: 'academic', search: searchArxiv },
  crossref: {
    label: 'Crossref',
    sourceType: 'academic',
    search: searchCrossref,
  },
  github: { label: 'GitHub', sourceType: 'code', search: searchGitHub },
  hackernews: {
    label: 'Hacker News',
    sourceType: 'community',
    search: searchHackerNews,
  },
  stackexchange: {
    label: 'Stack Exchange',
    sourceType: 'community',
    search: searchStackExchange,
  },
}
