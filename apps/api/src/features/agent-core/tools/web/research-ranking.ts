import type { ResearchBackend, ResearchSearchHit, ResearchSourceType } from './research-backends'

const TRACKING_PARAM = /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|ref_src)$/i

export interface ResearchObservation {
  query: string
  provider: ResearchBackend
  rank: number
  hit: ResearchSearchHit
}

export interface RankedResearchCandidate {
  url: string
  readUrl?: string
  title: string
  snippet: string
  hostname: string
  providers: ResearchBackend[]
  queries: string[]
  sourceTypes: ResearchSourceType[]
  publishedAt?: string
  score: number
  supplied: boolean
  suppliedIndex?: number
}

export function normalizeResearchDomain(value: string): string | null {
  const raw = value.trim().toLowerCase()
  if (!raw) return null
  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`)
    return parsed.hostname.replace(/^\.+|\.+$/g, '') || null
  } catch {
    return null
  }
}

export function canonicalizeResearchUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    // Never carry credentials into a fetch, persisted transcript or clickable UI.
    if (url.username || url.password) return null
    url.hash = ''
    const trackingKeys = new Set<string>()
    for (const key of url.searchParams.keys()) if (TRACKING_PARAM.test(key)) trackingKeys.add(key)
    for (const key of trackingKeys) url.searchParams.delete(key)
    url.searchParams.sort()
    return url.href
  } catch {
    return null
  }
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

export function urlPassesResearchDomainFilters(
  url: string,
  includeDomains: readonly string[],
  excludeDomains: readonly string[],
): boolean {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  if (excludeDomains.some((domain) => domainMatches(hostname, domain))) return false
  return (
    includeDomains.length === 0 || includeDomains.some((domain) => domainMatches(hostname, domain))
  )
}

/**
 * Aggregation across providers: canonical URL is the identity, every independent
 * query/provider occurrence contributes reciprocal-rank score, and the richest
 * title/snippet wins. Supplied URLs remain first but pass the same safety/filter
 * rules as discovered hits.
 */
export function rankResearchCandidates(input: {
  observations: readonly ResearchObservation[]
  suppliedUrls?: readonly string[]
  includeDomains?: readonly string[]
  excludeDomains?: readonly string[]
}): RankedResearchCandidate[] {
  const includeDomains = input.includeDomains ?? []
  const excludeDomains = input.excludeDomains ?? []
  const candidates = new Map<string, RankedResearchCandidate>()

  for (const [suppliedIndex, rawUrl] of (input.suppliedUrls ?? []).entries()) {
    const url = canonicalizeResearchUrl(rawUrl)
    if (!url || !urlPassesResearchDomainFilters(url, includeDomains, excludeDomains)) continue
    const hostname = new URL(url).hostname
    candidates.set(url, {
      url,
      title: hostname,
      snippet: '',
      hostname,
      providers: [],
      queries: [],
      sourceTypes: ['web'],
      score: Number.POSITIVE_INFINITY,
      supplied: true,
      suppliedIndex,
    })
  }

  for (const observation of input.observations) {
    const url = canonicalizeResearchUrl(observation.hit.url)
    if (!url || !urlPassesResearchDomainFilters(url, includeDomains, excludeDomains)) continue
    const existing = candidates.get(url)
    const title = observation.hit.title.trim() || new URL(url).hostname
    const snippet = observation.hit.snippet.trim()
    if (!existing) {
      candidates.set(url, {
        url,
        title,
        snippet,
        hostname: new URL(url).hostname,
        providers: [observation.provider],
        queries: [observation.query],
        sourceTypes: [observation.hit.sourceType],
        ...(observation.hit.readUrl ? { readUrl: observation.hit.readUrl } : {}),
        ...(observation.hit.publishedAt ? { publishedAt: observation.hit.publishedAt } : {}),
        score: 1 / (60 + Math.max(1, observation.rank)),
        supplied: false,
      })
      continue
    }
    if (!existing.providers.includes(observation.provider)) {
      existing.providers.push(observation.provider)
    }
    if (!existing.queries.includes(observation.query)) existing.queries.push(observation.query)
    if (!existing.sourceTypes.includes(observation.hit.sourceType)) {
      existing.sourceTypes.push(observation.hit.sourceType)
    }
    if (!existing.readUrl && observation.hit.readUrl) existing.readUrl = observation.hit.readUrl
    if (!existing.publishedAt && observation.hit.publishedAt) {
      existing.publishedAt = observation.hit.publishedAt
    }
    if (title.length > existing.title.length) existing.title = title
    if (snippet.length > existing.snippet.length) existing.snippet = snippet
    if (!existing.supplied) {
      existing.score += 1 / (60 + Math.max(1, observation.rank))
    }
  }

  return [...candidates.values()].sort(
    (a, b) =>
      Number(b.supplied) - Number(a.supplied) ||
      (a.supplied && b.supplied
        ? (a.suppliedIndex ?? Number.MAX_SAFE_INTEGER) -
          (b.suppliedIndex ?? Number.MAX_SAFE_INTEGER)
        : 0) ||
      b.score - a.score ||
      b.providers.length - a.providers.length ||
      b.queries.length - a.queries.length ||
      a.url.localeCompare(b.url),
  )
}

/**
 * Keep the final evidence set domain-diverse. Explicit URLs are never discarded;
 * automatically discovered pages are capped at two per host.
 */
export function selectResearchCandidates(
  ranked: readonly RankedResearchCandidate[],
  maxSources: number,
): RankedResearchCandidate[] {
  const selected: RankedResearchCandidate[] = []
  const perHost = new Map<string, number>()
  for (const candidate of ranked) {
    if (selected.length >= maxSources) break
    const count = perHost.get(candidate.hostname) ?? 0
    if (!candidate.supplied && count >= 2) continue
    selected.push(candidate)
    perHost.set(candidate.hostname, count + 1)
  }
  return selected
}
