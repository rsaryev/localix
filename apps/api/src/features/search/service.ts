import type { SearchHit, SearchProviderRegistry, SearchQuery } from '../agent-core/search/provider'
import type { SearchGroup, SearchRequest, SearchResponse } from './contracts'

/**
 * Global-search service — the LAYERED core the `POST /rpc/search` route AND a future
 * agent tool both call. It fans a query out through the provider registry, then owns
 * cross-provider ranking, grouping (registry order), and cursor pagination. Providers
 * stay dumb (a flat `SearchHit[]`, plus a `problem` when their domain could not answer);
 * everything user-facing is decided here.
 *
 * Two views:
 *  - AGGREGATE (no domain, or several): top-N per domain group + a flat preview page.
 *  - SCOPED (exactly one domain): one group paginated by an opaque offset cursor
 *    (drives the tab's per-group "Show all →" infinite scroll).
 */

/** Default hits shown per domain in the aggregate view (before "Show all"). */
export const DEFAULT_GROUP_LIMIT = 6
/** Default page size for a scoped (single-domain / "show all") query. */
export const DEFAULT_PAGE_LIMIT = 30
/** Per-provider soft cap in the aggregate fan-out (one domain can't flood the merge). */
export const AGGREGATE_PROVIDER_CAP = 24
/** Per-provider cap when a single domain is scoped (allows deeper paging). */
export const SCOPED_PROVIDER_CAP = 200

export interface SearchService {
  search(userId: string, req: SearchRequest): Promise<SearchResponse>
}

/** Sort hits by score desc, stable on title so output is deterministic. */
export function sortHits(hits: SearchHit[]): SearchHit[] {
  return [...hits].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
}

/** Parse an opaque numeric offset cursor; non-numeric / negative → 0. */
export function parseCursor(cursor: string | undefined): number {
  const n = cursor ? Number.parseInt(cursor, 10) : 0
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Provider metadata the service needs for group headers, in registry order. */
export interface DomainMeta {
  id: string
  title: string
  icon?: string
}

/** Group flat hits by domain in the provider registration order, each capped to `groupLimit`. */
export function groupHits(
  hits: SearchHit[],
  order: DomainMeta[],
  groupLimit: number,
): SearchGroup[] {
  const byDomain = new Map<string, SearchHit[]>()
  for (const h of hits) {
    const arr = byDomain.get(h.domain)
    if (arr) arr.push(h)
    else byDomain.set(h.domain, [h])
  }
  const groups: SearchGroup[] = []
  for (const meta of order) {
    const domainHits = byDomain.get(meta.id)
    if (!domainHits || domainHits.length === 0) continue
    const sorted = sortHits(domainHits)
    groups.push({
      domain: meta.id,
      title: meta.title,
      icon: meta.icon,
      hits: sorted.slice(0, groupLimit),
      total: sorted.length,
    })
  }
  return groups
}

export function createSearchService(opts: { registry: SearchProviderRegistry }): SearchService {
  const { registry } = opts
  return {
    async search(userId, req) {
      const scoped = !!req.domains && req.domains.length === 1
      const query: SearchQuery = {
        text: req.text,
        domains: req.domains,
        limitPerProvider: scoped ? SCOPED_PROVIDER_CAP : AGGREGATE_PROVIDER_CAP,
        sessionId: req.sessionId ?? null,
        projectId: req.projectId ?? null,
      }
      const { hits: raw, problems } = await registry.searchAll(userId, query)
      // Absent, not empty: a response carrying `problems: []` would make every surface
      // branch on length instead of presence, and the wire would say "something failed"
      // on every healthy search.
      const incomplete = problems.length > 0 ? { problems } : {}
      const order: DomainMeta[] = registry
        .list()
        .map((p) => ({ id: p.id, title: p.title, icon: p.icon }))

      if (scoped) {
        // Single-domain: one paginated group + a flat cursor page (infinite scroll).
        const sorted = sortHits(raw)
        const pageLimit = req.limit ?? DEFAULT_PAGE_LIMIT
        const offset = parseCursor(req.cursor)
        const page = sorted.slice(offset, offset + pageLimit)
        const domain = req.domains![0]!
        const meta = order.find((p) => p.id === domain)
        const group: SearchGroup = {
          domain,
          title: meta?.title ?? domain,
          icon: meta?.icon,
          hits: page,
          total: sorted.length,
        }
        const nextOffset = offset + page.length
        return {
          groups: page.length > 0 ? [group] : [],
          hits: page,
          total: sorted.length,
          nextCursor: nextOffset < sorted.length ? String(nextOffset) : undefined,
          ...incomplete,
        }
      }

      // Aggregate: top-N per domain (registry order) + a flat cross-domain preview page.
      const groupLimit = req.limit ?? DEFAULT_GROUP_LIMIT
      const groups = groupHits(raw, order, groupLimit)
      const flat = sortHits(raw).slice(0, DEFAULT_PAGE_LIMIT)
      return { groups, hits: flat, total: raw.length, ...incomplete }
    },
  }
}
