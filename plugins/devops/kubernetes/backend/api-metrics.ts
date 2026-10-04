import { parseNodeMetricsList, parsePodMetricsList } from './metrics'
import { ALL_NAMESPACES, type NodeUsage, type PodUsage } from './contracts'

/**
 * The IMPURE half of usage metrics: the `metrics.k8s.io` request, the short-lived
 * cache, and — the part that actually matters — treating an absent metrics-server
 * as MISSING DATA rather than as an error.
 *
 * `metrics-server` is an optional add-on. A kind/minikube cluster without it answers
 * `/apis/metrics.k8s.io/v1beta1/pods` with 404, and a namespace-scoped user gets 403.
 * Those responses make usage data unavailable but do not invalidate the surrounding
 * workload list, so the public fetches return `null` and let the list keep rendering.
 */

/** GET a cluster path and parse JSON; rejects on transport or non-2xx. */
export type FetchClusterJson = (path: string) => Promise<unknown>

export interface PodMetricsResult {
  /** `null` when the cluster serves no metrics API (or forbids it) — not an error. */
  pods: PodUsage[] | null
}

export interface NodeMetricsResult {
  nodes: NodeUsage[] | null
}

/**
 * Cache TTL.
 *
 * metrics-server itself only scrapes every 15s by default, so a substantially shorter
 * TTL would mostly repeat the same number and add load. Ten seconds keeps a live pod
 * list near the scrape cadence while coalescing requests when a pod list, node list,
 * and pod tab all ask on the same tick.
 */
export const METRICS_TTL_MS = 10_000

interface CacheEntry {
  at: number
  /** The in-flight promise is cached, not just the result — three panels, one request. */
  value: Promise<unknown>
}

const cache = new Map<string, CacheEntry>()

function cachedFetch(
  cacheKey: string,
  path: string,
  fetchJson: FetchClusterJson,
  now: () => number,
): Promise<unknown> {
  const key = `${cacheKey}\n${path}`
  const cached = cache.get(key)
  if (cached && now() - cached.at < METRICS_TTL_MS) return cached.value

  const entry: CacheEntry = { at: now(), value: fetchJson(path) }
  cache.set(key, entry)
  entry.value.catch(() => {
    // Only evict OUR entry, so a concurrent refresh is not undone by our failure.
    if (cache.get(key) === entry) cache.delete(key)
  })
  return entry.value
}

/** Drop cached usage — for one context, or all of them. */
export function invalidateMetrics(cacheKey?: string): void {
  if (cacheKey === undefined) {
    cache.clear()
    return
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${cacheKey}\n`)) cache.delete(key)
  }
}

const BASE = '/apis/metrics.k8s.io/v1beta1'

function podsPath(namespace: string): string {
  return !namespace || namespace === ALL_NAMESPACES
    ? `${BASE}/pods`
    : `${BASE}/namespaces/${encodeURIComponent(namespace)}/pods`
}

/**
 * Pod usage for a namespace (or every namespace).
 *
 * Resolves to `{ pods: null }` when the metrics API is unreachable. The caller renders
 * that as empty usage columns; it must not turn a healthy pod list into an error state.
 */
export async function fetchPodMetrics(
  cacheKey: string,
  namespace: string,
  fetchJson: FetchClusterJson,
  now: () => number = Date.now,
): Promise<PodMetricsResult> {
  try {
    const body = await cachedFetch(cacheKey, podsPath(namespace), fetchJson, now)
    return { pods: parsePodMetricsList(body) }
  } catch {
    return { pods: null }
  }
}

/** Node usage. Same absent-metrics contract as {@link fetchPodMetrics}. */
export async function fetchNodeMetrics(
  cacheKey: string,
  fetchJson: FetchClusterJson,
  now: () => number = Date.now,
): Promise<NodeMetricsResult> {
  try {
    const body = await cachedFetch(cacheKey, `${BASE}/nodes`, fetchJson, now)
    return { nodes: parseNodeMetricsList(body) }
  } catch {
    return { nodes: null }
  }
}
