import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'

import { errorMessage } from '../../lib/errors'
import {
  readMiniAppCatalogFeed,
  type MiniAppCatalogEditorial,
  type MiniAppCatalogLink,
} from './catalog-feed'
import { catalogSignatureState } from './catalog-signature'
import type { MiniAppStoreSource, Offer } from './store-offer-types'

export type {
  MiniAppPublisher,
  MiniAppStoreSource,
  Offer,
  OfferFile,
  OfferMeta,
  OfferStore,
} from './store-offer-types'

/** The manifest of an installed app's folder, or null when there is none or it does not parse. */
export async function readManifest(dir: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(join(dir, MINI_APP_MANIFEST_FILE), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

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
  /**
   * Keep the key a catalog a person added was first read signed with (`catalogs.ts`). The Localix
   * catalog's key is pinned in code and never taken from what it serves.
   */
  pinKey?: (url: string, key: string) => Promise<void>
  /**
   * The keys kept for catalogs a list links to (Localix Community's authors'), each from its first
   * signed read, as for a catalog the person added (`catalogs.ts`).
   */
  linkedKeys?: {
    get(url: string): Promise<string | undefined>
    pin(url: string, key: string): Promise<void>
  }
}) {
  const ttl = deps.ttlMs ?? 10 * 60_000
  const now = deps.now ?? Date.now
  type Read = { offers: Offer[]; links: MiniAppCatalogLink[]; editorial?: MiniAppCatalogEditorial }
  const cache = new Map<string, Read & { at: number }>()

  async function catalogOffers(
    source: MiniAppStoreSource,
    fresh: boolean,
    pin = deps.pinKey,
  ): Promise<Read> {
    const cached = cache.get(source.url)
    if (cached && !fresh && now() - cached.at < ttl) return cached
    const {
      apps,
      links,
      editorial,
      signature: read,
    } = await readMiniAppCatalogFeed(source.url, {
      fetchImpl: deps.fetchImpl,
    })
    let kept = source.key
    if (!kept && !source.vouches && read.state === 'signed' && pin) {
      await pin(source.url, read.key)
      kept = read.key
    }
    const signature = catalogSignatureState(read, kept)
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
      signature,
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
        // And so is what it is for: a catalog someone added cannot steer recommendations.
        ...(app.suits && source.vouches ? { suits: app.suits } : {}),
        ...(app.surfaces ? { surfaces: app.surfaces } : {}),
        ...(app.commands ? { commands: app.commands } : {}),
        // What it opens is a fact about the app, not a pick: any catalog may say it.
        ...(app.fileAssociations?.length ? { opens: app.fileAssociations } : {}),
      },
      from: 'catalog',
      catalog: source.url,
      archive: app.archive,
    }))
    // Discover's picks are Localix's own word, like featured.
    const held = {
      at: now(),
      offers,
      links,
      ...(editorial && source.vouches ? { editorial } : {}),
    }
    cache.set(source.url, held)
    return held
  }

  /**
   * The app a list links to, read from its own catalog — which says what it is and signs it, with
   * the key kept from that catalog's first signed read — and offered under the list: the list's
   * trust and label, the list's words only where its catalog says nothing. A link is followed
   * once: the linked catalog's own links are not.
   */
  async function linkedOffer(
    list: MiniAppStoreSource,
    link: MiniAppCatalogLink,
    fresh: boolean,
  ): Promise<Offer | { problem: string }> {
    const key = await deps.linkedKeys?.get(link.url)
    const source: MiniAppStoreSource = {
      kind: 'catalog',
      url: link.url,
      vouches: false,
      ...(key ? { key } : {}),
    }
    let read: Read
    try {
      read = await catalogOffers(source, fresh, deps.linkedKeys?.pin)
    } catch (error) {
      const held = cache.get(link.url)
      if (!held) return { problem: `${link.name}: ${errorMessage(error)}` }
      read = held
    }
    const offer = read.offers.find((found) => found.name === link.name)
    if (!offer) return { problem: `${link.name} is not in its catalog (${link.url})` }
    return {
      ...offer,
      source: list.url,
      description: offer.description || link.description || '',
      ...(offer.category || link.category ? { category: offer.category ?? link.category } : {}),
      store: {
        ...offer.store,
        ...(offer.store.homepage || link.homepage
          ? { homepage: offer.store.homepage ?? link.homepage }
          : {}),
      },
    }
  }

  /**
   * Every offer by name — the first source to offer a name wins it — and what could not be read.
   * A list's links come after its own apps, before the next source.
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
      const address = source.url
      let found: Read
      try {
        found = await catalogOffers(source, opts.fresh ?? false)
      } catch (error) {
        problems.push(errorMessage(error))
        failed[address] = errorMessage(error)
        found = cache.get(source.url) ?? { offers: [], links: [] }
      }
      for (const offer of found.offers) if (!offers.has(offer.name)) offers.set(offer.name, offer)
      const linked = await Promise.all(
        found.links
          .filter((link) => !offers.has(link.name))
          .map((link) => linkedOffer(source, link, opts.fresh ?? false)),
      )
      for (const result of linked) {
        if ('problem' in result) problems.push(result.problem)
        else if (!offers.has(result.name)) offers.set(result.name, result)
      }
      if (found.editorial) editorial.push({ source: address, editorial: found.editorial })
    }
    return { offers, problems, failed, editorial }
  }
}
