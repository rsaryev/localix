import { pathToFileURL } from 'node:url'

import { errorMessage } from '../../lib/errors'
import { readMiniAppCatalogFeed, type MiniAppCatalogEditorial } from './catalog-feed'
import { localOffers } from './store-offers-local'
import type { MiniAppStoreSource, Offer } from './store-offer-types'

export { CATALOG_PICKS_FILE } from './store-offer-types'
export type {
  MiniAppPublisher,
  MiniAppStoreSource,
  Offer,
  OfferFile,
  OfferMeta,
  OfferStore,
} from './store-offer-types'
export { readManifest } from './store-offers-local'

/**
 * Reads what every source offers, a hosted catalog at most once per `ttlMs`. A catalog that
 * cannot be read keeps its last good list and is reported as a problem; the other sources still
 * answer.
 */
export function createOfferReader(deps: {
  sources: () => MiniAppStoreSource[] | Promise<MiniAppStoreSource[]>
  fetchImpl?: typeof fetch
  ttlMs?: number
  now?: () => number
}) {
  const ttl = deps.ttlMs ?? 10 * 60_000
  const now = deps.now ?? Date.now
  const cache = new Map<
    string,
    { at: number; offers: Offer[]; editorial?: MiniAppCatalogEditorial }
  >()

  async function catalogOffers(
    source: Extract<MiniAppStoreSource, { kind: 'catalog' }>,
    fresh: boolean,
  ): Promise<{ offers: Offer[]; editorial?: MiniAppCatalogEditorial }> {
    const cached = cache.get(source.url)
    if (cached && !fresh && now() - cached.at < ttl) return cached
    const { apps, editorial } = await readMiniAppCatalogFeed(source.url, {
      fetchImpl: deps.fetchImpl,
    })
    const pinned = (file: { url: string; bytes: number; sha256: string; type?: string }) => ({
      from: 'catalog' as const,
      url: file.url,
      bytes: file.bytes,
      sha256: file.sha256,
      type: file.type ?? 'text/markdown',
    })
    const offers = apps.map((app): Offer => ({
      name: app.name,
      ...(app.displayName ? { displayName: app.displayName } : {}),
      description: app.description,
      ...(app.category ? { category: app.category } : {}),
      version: app.version,
      ...(app.apiVersion ? { apiVersion: app.apiVersion } : {}),
      publisher: { name: app.publisher.name, verified: source.vouches && app.publisher.verified },
      source: source.url,
      store: {
        ...(app.icon ? { icon: pinned(app.icon) } : {}),
        screenshots: (app.screenshots ?? []).map((shot) => ({
          ...pinned(shot),
          ...(shot.caption ? { caption: shot.caption } : {}),
        })),
        ...(app.readme ? { readme: pinned(app.readme) } : {}),
        tags: app.tags ?? [],
        ...(app.homepage ? { homepage: app.homepage } : {}),
        ...(app.license ? { license: app.license } : {}),
        ...(app.author ? { author: app.author } : {}),
        // Featured is Localix's own word: a catalog someone added cannot put itself on top.
        ...(app.featured && source.vouches ? { featured: true } : {}),
        // So is recommended: only Localix installs something without being asked.
        ...(app.recommended && source.vouches ? { recommended: true } : {}),
        ...(app.surfaces ? { surfaces: app.surfaces } : {}),
        ...(app.commands ? { commands: app.commands } : {}),
      },
      from: 'catalog',
      catalog: source.url,
      archive: app.archive,
    }))
    // Discover's picks are Localix's own word, like featured.
    const held = { at: now(), offers, ...(editorial && source.vouches ? { editorial } : {}) }
    cache.set(source.url, held)
    return held
  }

  /**
   * Every offer by name — the first source to offer a name wins it — and what could not be read.
   */
  return async function read(opts: { fresh?: boolean } = {}): Promise<{
    offers: Map<string, Offer>
    problems: string[]
    /** Why a source could not be read this time, by its address. */
    failed: Record<string, string>
    /** Each vouched source's picks for Discover, by the source's address. */
    editorial: Array<{ source: string; editorial: MiniAppCatalogEditorial }>
  }> {
    const offers = new Map<string, Offer>()
    const editorial: Array<{ source: string; editorial: MiniAppCatalogEditorial }> = []
    const problems: string[] = []
    const failed: Record<string, string> = {}
    for (const source of await deps.sources()) {
      const address = source.kind === 'catalog' ? source.url : pathToFileURL(source.root).href
      let found: { offers: Offer[]; editorial?: MiniAppCatalogEditorial }
      try {
        found =
          source.kind === 'local'
            ? await localOffers(source)
            : await catalogOffers(source, opts.fresh ?? false)
      } catch (error) {
        problems.push(errorMessage(error))
        failed[address] = errorMessage(error)
        found =
          source.kind === 'catalog' ? (cache.get(source.url) ?? { offers: [] }) : { offers: [] }
      }
      for (const offer of found.offers) if (!offers.has(offer.name)) offers.set(offer.name, offer)
      if (found.editorial) editorial.push({ source: address, editorial: found.editorial })
    }
    return { offers, problems, failed, editorial }
  }
}
