import type { ThinkingLevelMap } from '@earendil-works/pi-ai'

import { setPublishedThinkingLevels } from './providers'

/**
 * What a provider says about its own models, fetched once and cached.
 *
 * TWO facts ride on one request. Release dates order the catalog. Reasoning levels decide what
 * the picker offers and what the per-request clamp accepts — and those come from the provider
 * because the alternative is a snapshot: `vendor/pi`'s model data is GENERATED from this same
 * field and then frozen at sync time, so it is wrong the moment a vendor changes a model. That
 * was visible as a picker offering `xhigh` for a model whose provider lists low/high/max, and
 * hiding the three levels it does have.
 *
 * Nothing here knows a model or a vendor. Whatever the provider publishes wins; where it
 * publishes nothing, the generated data stands.
 */

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const CATALOG_METADATA_TIMEOUT_MS = 1_500

/**
 * The shortest gap between two background refreshes.
 *
 * NOT a freshness gate — nothing is ever served BECAUSE it is younger than this. It only stops
 * a page that opens the catalog five times from making five requests. An age gate is what this
 * used to be, and it failed twice in one day: it hid newly published levels for a day, and then
 * called a two-hour-old snapshot from the previous BUILD fresh. The provider is now asked on
 * every launch, and the snapshot is what the first frame and an offline machine get.
 */
const REFRESH_INTERVAL_MS = 5 * 60 * 1_000

/** `undefined` is "never asked in this process", which no clock arithmetic can express. */
let lastRefreshAt: number | undefined
let refreshInFlight: Promise<unknown> | undefined

export type CatalogFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** What gets persisted: the metadata plus when it was retrieved. */
export interface CatalogMetadataSnapshot {
  fetchedAt: number
  releaseDates: Record<string, string>
  /**
   * Per-model reasoning levels as the provider published them. Written on every refresh, even
   * empty; absent only in a snapshot from a build that did not yet ask for them.
   */
  thinkingLevels?: Record<string, ThinkingLevelMap>
}

/**
 * Somewhere durable to keep {@link CatalogMetadataSnapshot} between runs.
 *
 * A seam rather than a path because this package must not learn where the host keeps its state —
 * the API layer supplies a file in `~/.localix`, tests supply a plain object. Both methods may
 * throw (or reject); the caller treats a failure as "no cache". `write` may be async so a host can
 * replace its file atomically.
 */
export interface CatalogMetadataStore {
  read(): CatalogMetadataSnapshot | undefined
  write(snapshot: CatalogMetadataSnapshot): void | Promise<void>
}

export interface PiCatalogOptions {
  fetch?: CatalogFetch
  metadataStore?: CatalogMetadataStore
  /** Clock seam — tests drive the refresh interval without waiting it out. */
  now?: () => number
}

/** The canonical scale, in order. `off` is handled separately — it is not a level, it is none. */
const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * Turn a provider's published effort list into pi's level map.
 *
 * The same conversion pi's own generator performs when it builds the committed snapshot
 * (`vendor/pi/packages/ai/scripts/openrouter-reasoning-options.ts`): a level the provider lists
 * maps to itself, one it does not maps to `null`, and `off` is available unless the provider
 * says reasoning is mandatory. Every level is written explicitly, because pi reads an ABSENT key
 * as "not mapped, pass the provider's own default through" — only a null means "cannot".
 */
function thinkingLevelMapFrom(reasoning: unknown): ThinkingLevelMap | undefined {
  if (!reasoning || typeof reasoning !== 'object') return undefined
  const { supported_efforts: efforts, mandatory } = reasoning as {
    supported_efforts?: unknown
    mandatory?: unknown
  }
  if (!Array.isArray(efforts) || efforts.length === 0) return undefined
  const published = new Set(efforts.filter((value): value is string => typeof value === 'string'))
  if (!THINKING_LEVELS.some((level) => published.has(level))) return undefined
  const map: ThinkingLevelMap = { off: mandatory === true ? null : 'none' }
  for (const level of THINKING_LEVELS) map[level] = published.has(level) ? level : null
  return map
}

/** What one metadata fetch yields: ordering dates, and what each model says it can think at. */
interface CatalogMetadata {
  dates: Map<string, string>
  thinking: Map<string, ThinkingLevelMap>
}

const EMPTY_METADATA: CatalogMetadata = { dates: new Map(), thinking: new Map() }

async function openRouterMetadata(fetchFn: CatalogFetch): Promise<CatalogMetadata> {
  try {
    const response = await fetchFn(OPENROUTER_MODELS_URL, {
      signal: AbortSignal.timeout(CATALOG_METADATA_TIMEOUT_MS),
    })
    if (!response.ok) return EMPTY_METADATA
    const body = (await response.json()) as { data?: unknown }
    if (!Array.isArray(body.data)) return EMPTY_METADATA
    const dates = new Map<string, string>()
    const thinking = new Map<string, ThinkingLevelMap>()
    for (const value of body.data) {
      if (!value || typeof value !== 'object') continue
      const { id, created, reasoning } = value as {
        id?: unknown
        created?: unknown
        reasoning?: unknown
      }
      if (typeof id !== 'string') continue
      if (typeof created === 'number' && Number.isFinite(created)) {
        const date = new Date(created * 1000)
        if (!Number.isNaN(date.getTime())) dates.set(`openrouter/${id}`, date.toISOString())
      }
      // Keyed by the id the provider uses for itself — that is how its own `getModels()` names
      // them, and that is where the override is applied.
      const map = thinkingLevelMapFrom(reasoning)
      if (map) thinking.set(id, map)
    }
    return { dates, thinking }
  } catch {
    // This metadata improves a catalog that already works: the complete generated pi catalog
    // remains available offline and on transient provider failures.
    return EMPTY_METADATA
  }
}

/**
 * The metadata this process currently serves: the persisted snapshot until a refresh lands, then
 * that refresh. In memory rather than re-read from the store per call, because a refresh that
 * landed must reach the NEXT catalog read of this process, not only the next launch.
 */
let publishedReleaseDates: ReadonlyMap<string, string> = new Map()
/** Whether the persisted snapshot was already read into memory — once per process. */
let storeLoaded = false
/** Bumped whenever {@link publishCatalogMetadata} changes what the catalog would answer. */
let metadataRevision = 0

function publishCatalogMetadata(
  dates: ReadonlyMap<string, string>,
  thinking: ReadonlyMap<string, ThinkingLevelMap>,
): void {
  publishedReleaseDates = dates
  if (thinking.size > 0) setPublishedThinkingLevels(thinking)
  metadataRevision += 1
}

/**
 * Which publish the catalog's metadata is at.
 *
 * A host that caches the catalog keys its cache on this. Without it, a cache built from the
 * generated snapshot survived the refresh that corrected it, so the picker kept offering the old
 * reasoning levels while the per-request clamp (which reads the live ones) refused them.
 */
export function catalogMetadataRevision(): number {
  return metadataRevision
}

/** Fetch, then publish and persist the answer when it carried anything worth keeping. */
async function refreshCatalogMetadata(
  fetchFn: CatalogFetch,
  store: CatalogMetadataStore | undefined,
  now: number,
): Promise<void> {
  const { dates, thinking } = await openRouterMetadata(fetchFn)
  // Empty is what a 503, a parse failure and being offline all produce. Publishing it would wipe a
  // good snapshot from memory, and persisting it would replace a good one on disk.
  if (dates.size === 0 && thinking.size === 0) return
  publishCatalogMetadata(dates, thinking)
  if (!store) return
  try {
    await store.write({
      fetchedAt: now,
      releaseDates: Object.fromEntries(dates),
      thinkingLevels: Object.fromEntries(thinking),
    })
  } catch {
    /* a cache we cannot write just means the next launch starts from the generated data */
  }
}

/**
 * Provider metadata without ever making a caller wait on the network.
 *
 * Measured on the packaged app: this fetch was the ENTIRE cost of the first
 * `GET /rpc/models/catalog` — 774 ms networked, and a full {@link CATALOG_METADATA_TIMEOUT_MS} on
 * a network that drops packets. A first launch (no snapshot yet) used to await it, and since a
 * failed fetch is never persisted, a machine that could not reach the provider paid it on EVERY
 * launch — before its first chat turn, which reads the catalog too. So nothing awaits it now: this
 * returns what is in memory (the persisted snapshot, or nothing, leaving the generated data), and
 * the refresh publishes when it lands, bumping {@link catalogMetadataRevision}.
 */
export function resolveCatalogMetadata(options: PiCatalogOptions): ReadonlyMap<string, string> {
  const fetchFn = options.fetch ?? globalThis.fetch
  const store = options.metadataStore
  const now = options.now?.() ?? Date.now()

  if (!storeLoaded) {
    storeLoaded = true
    let cached: CatalogMetadataSnapshot | undefined
    try {
      cached = store?.read()
    } catch {
      cached = undefined
    }
    if (cached) {
      publishCatalogMetadata(
        new Map(Object.entries(cached.releaseDates)),
        new Map(Object.entries(cached.thinkingLevels ?? {})),
      )
    }
  }

  // Always ask again, never wait for the answer. Its age decides nothing; the interval only stops
  // a page that opens the catalog five times from making five requests.
  if (
    !refreshInFlight &&
    (lastRefreshAt === undefined || now - lastRefreshAt >= REFRESH_INTERVAL_MS)
  ) {
    lastRefreshAt = now
    refreshInFlight = refreshCatalogMetadata(fetchFn, store, now)
      .catch(() => {})
      .finally(() => {
        refreshInFlight = undefined
      })
  }
  return publishedReleaseDates
}

/** Tests observe a refresh landing; nothing in the product awaits one. */
export function settleCatalogMetadataRefresh(): Promise<unknown> {
  return refreshInFlight ?? Promise.resolve()
}

/** Tests drive several launches through one module instance; this is the reset between them. */
export function resetCatalogMetadataRefreshState(): void {
  lastRefreshAt = undefined
  refreshInFlight = undefined
  storeLoaded = false
  publishedReleaseDates = new Map()
  setPublishedThinkingLevels(new Map())
}
