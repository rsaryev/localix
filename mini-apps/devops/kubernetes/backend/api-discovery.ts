import { type DiscoveredResource, parseApiResourceList, preferredGroupVersions } from './discovery'

/**
 * The IMPURE half of API discovery: the fan-out, the partial-failure tolerance and the cache.
 *
 * Split from `discovery.ts` so the parsing/resolution rules stay testable as data, and so the parts
 * with real failure modes — a group that 503s, forty requests at once, a cache that outlives a
 * `kubectl apply` of a new CRD — are testable too. The one dependency is a JSON GET, injected: this
 * module never touches `KubeConfig`, which is also what keeps it out of an import cycle with
 * `api-backend.ts`.
 */

/** GET a cluster path and parse JSON. Rejects on transport or non-2xx. */
export type FetchClusterJson = (path: string) => Promise<unknown>

export interface ClusterResources {
  resources: DiscoveredResource[]
  /**
   * Group-versions the cluster ADVERTISED but could not serve.
   *
   * Not an error: an aggregated API server (metrics-server, a broken webhook-backed CRD) going down
   * makes its `/apis/<gv>` fail while the other forty groups answer fine. `kubectl` warns and carries
   * on, and so must we — failing the whole discovery would take the workbench's entire resource
   * picker down with one unhealthy add-on. Surfaced so the caller can say WHICH kinds are missing
   * instead of silently showing a short list.
   */
  unavailable: string[]
}

/**
 * Concurrency for the per-group fan-out.
 *
 * A stock cluster advertises ~25 groups and one with a service mesh + operators reaches 60. Firing
 * them all at once is a burst the API server's priority-and-fairness queues will start rejecting
 * (429), which turns into spurious `unavailable` entries; serial is ~60 round-trips of latency.
 * Eight is the same order `kubectl` uses for its parallel discovery.
 */
const GROUP_CONCURRENCY = 8

/** Run `worker` over `items` with at most `limit` in flight, preserving nothing (results collected). */
async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = []
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      out.push(await worker(items[index]!))
    }
  })
  await Promise.all(runners)
  return out
}

/**
 * Ask the cluster what it serves: core `v1`, then every group's preferred version.
 *
 * Core and the group list are fetched together — they are independent and both are needed before any
 * group-version can be asked. If `/api/v1` fails the result is still usable (groups only) and vice
 * versa; both failing yields an empty resource list with both recorded as unavailable, which the
 * caller reports as "discovery failed" rather than "this cluster serves nothing".
 */
export async function discoverClusterResources(
  fetchJson: FetchClusterJson,
): Promise<ClusterResources> {
  const unavailable: string[] = []
  const [core, groups] = await Promise.all([
    fetchJson('/api/v1').catch(() => {
      unavailable.push('v1')
      return null
    }),
    fetchJson('/apis').catch(() => {
      unavailable.push('/apis')
      return null
    }),
  ])

  const resources = core ? parseApiResourceList('v1', core) : []
  const groupVersions = preferredGroupVersions(groups)

  const perGroup = await mapPool(groupVersions, GROUP_CONCURRENCY, async (groupVersion) => {
    try {
      return parseApiResourceList(groupVersion, await fetchJson(`/apis/${groupVersion}`))
    } catch {
      unavailable.push(groupVersion)
      return []
    }
  })

  return { resources: [...resources, ...perGroup.flat()], unavailable }
}

/**
 * Cache TTL.
 *
 * Discovery is 25-60 requests, so doing it per keystroke in a resource picker is not an option; but a
 * user who just `kubectl apply`d a CRD expects to find it. Five minutes is `kubectl`'s own discovery
 * cache TTL — the same trade-off, already tuned against the same expectation. {@link invalidateDiscovery}
 * exists for the case where waiting is wrong.
 */
const DISCOVERY_TTL_MS = 300_000

interface CacheEntry {
  at: number
  /** The in-flight promise is cached, not just the result — see `getClusterResources`. */
  value: Promise<ClusterResources>
}

const cache = new Map<string, CacheEntry>()

/**
 * Cached discovery, keyed by context.
 *
 * Caches the PROMISE. A workbench mounting three panels discovers three times on the same tick if the
 * cache only holds settled results — 150 requests for one answer. Keyed by context because two
 * clusters serve different CRDs and answering with the wrong cluster's kinds would be worse than
 * being slow. A rejected discovery is evicted so the next caller retries rather than inheriting a
 * cached failure for five minutes.
 */
export function getClusterResources(
  cacheKey: string,
  fetchJson: FetchClusterJson,
  now: () => number = Date.now,
): Promise<ClusterResources> {
  const cached = cache.get(cacheKey)
  if (cached && now() - cached.at < DISCOVERY_TTL_MS) return cached.value

  const entry: CacheEntry = { at: now(), value: discoverClusterResources(fetchJson) }
  cache.set(cacheKey, entry)
  entry.value.catch(() => {
    // Only evict OUR entry: a concurrent invalidate + refetch must not be undone by our failure.
    if (cache.get(cacheKey) === entry) cache.delete(cacheKey)
  })
  return entry.value
}

/** Drop cached discovery — for one context, or all of them. */
export function invalidateDiscovery(cacheKey?: string): void {
  if (cacheKey === undefined) cache.clear()
  else cache.delete(cacheKey)
}
