import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'
import {
  marketplaceAppId,
  type MarketplaceApp,
  type MarketplaceRevocation,
} from '@localixai/mini-app-sdk/marketplace'
import type { MarketplaceSignatureState } from '@localixai/mini-app-sdk/marketplace-signature'
import type { Curation } from '@localixai/store'

import { errorMessage } from '../../lib/errors'
import { readMarketplaceFeed, type MarketplaceFeed, type MarketplaceLink } from './marketplace-feed'
import { judgeMarketplace, type KeptTrust } from './marketplace-trust'
import type {
  MiniAppMarketplaceSource,
  MiniAppPublisher,
  Offer,
  OfferRead,
  Revocation,
} from './store-offer-types'

export type {
  MiniAppMarketplaceSource,
  MiniAppPublisher,
  Offer,
  OfferFile,
  OfferMeta,
  OfferRead,
  OfferStore,
  Revocation,
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

/** What Localix keeps to judge each marketplace's signatures, by its address (`marketplaces.ts`). */
export interface OfferTrust {
  get(url: string): Promise<KeptTrust | undefined>
  keep(url: string, kept: KeptTrust): Promise<void>
}

/** One marketplace as last read and judged. */
type Held = { at: number; feed: MarketplaceFeed; signature: MarketplaceSignatureState }

/** Whether a revocation takes back `version`: every version, or this one by name. */
const takesBack = (revoked: MarketplaceRevocation | undefined, version: string | undefined) =>
  !!revoked && (!revoked.versions || (!!version && revoked.versions.includes(version)))

const revocationOf = (
  name: string,
  marketplace: string,
  revoked: MarketplaceRevocation,
): Revocation => ({
  id: marketplaceAppId(name, marketplace),
  name,
  marketplace,
  reason: revoked.reason,
  ...(revoked.versions ? { versions: revoked.versions } : {}),
})

/** An app built beside its marketplace, as an offer; null for one that is not (a link). */
function offerOf(
  app: MarketplaceApp,
  at: {
    marketplace: string
    publisher: MiniAppPublisher
    source: string
    from: string
    signature: MarketplaceSignatureState
    curation: Curation
  },
): Offer | null {
  if (app.source?.source !== 'archive') return null
  const { url, bytes, sha256 } = app.source
  const { featured, installByDefault, suggestFor } = at.curation
  return {
    id: marketplaceAppId(app.name, at.marketplace),
    name: app.name,
    marketplace: at.marketplace,
    ...(app.displayName ? { displayName: app.displayName } : {}),
    description: app.description ?? '',
    ...(app.category ? { category: app.category } : {}),
    ...(app.version ? { version: app.version } : {}),
    ...(app.apiVersion ? { apiVersion: app.apiVersion } : {}),
    publisher: at.publisher,
    source: at.source,
    signature: at.signature,
    store: {
      ...(app.icon ? { icon: app.icon } : {}),
      screenshots: app.screenshots ?? [],
      ...(app.readme ? { readme: { ...app.readme, type: 'text/markdown' } } : {}),
      tags: app.tags ?? [],
      ...(app.homepage ? { homepage: app.homepage } : {}),
      ...(app.license ? { license: app.license } : {}),
      ...(app.author ? { author: app.author } : {}),
      // Curation is the keeper's word, honoured only from a marketplace Localix vouches for: one
      // someone added cannot put itself on top, install itself, or steer suggestions.
      ...(featured ? { featured } : {}),
      ...(installByDefault ? { installByDefault } : {}),
      ...(suggestFor ? { suggestFor } : {}),
      ...(app.surfaces ? { surfaces: app.surfaces } : {}),
      ...(app.commands ? { commands: app.commands } : {}),
      // What it opens is a fact about the app, not a pick: any marketplace may say it.
      ...(app.opens?.length ? { opens: app.opens } : {}),
    },
    from: at.from,
    archive: { url, bytes, sha256 },
  }
}

/**
 * Reads what every marketplace offers (`docs/extending/mini-app-marketplace.md`), each at most once
 * per `ttlMs`. Every read is judged (`marketplace-trust.ts`) and what changes is kept. One that
 * cannot be read, is refused as older than one already read, or now calls itself something else
 * keeps its last good read and is reported; the others still answer. Every app is offered under
 * its identity, `<name>@<marketplace>`, so the same name in two marketplaces is two apps.
 */
export function createOfferReader(deps: {
  sources: () => MiniAppMarketplaceSource[] | Promise<MiniAppMarketplaceSource[]>
  trust: OfferTrust
  fetchImpl?: typeof fetch
  ttlMs?: number
  now?: () => number
}) {
  const ttl = deps.ttlMs ?? 10 * 60_000
  const now = deps.now ?? Date.now
  const cache = new Map<string, Held>()

  async function readHeld(
    url: string,
    how: { pinned?: readonly string[]; firstUse: boolean; name?: string },
    fresh: boolean,
  ): Promise<Held> {
    const cached = cache.get(url)
    if (cached && !fresh && now() - cached.at < ttl) return cached
    const feed = await readMarketplaceFeed(url, { fetchImpl: deps.fetchImpl })
    const { name, published, signingKeys } = feed.marketplace
    // Its name is half of every identity it gave: under another, its apps would be other apps.
    if (how.name && name !== how.name)
      throw new Error(
        `it now calls itself "${name}", not "${how.name}"; remove it and add it again`,
      )
    const verdict = judgeMarketplace({
      signatures: feed.signatures,
      published,
      signingKeys,
      kept: await deps.trust.get(url),
      pinned: how.pinned,
      firstUse: how.firstUse,
    })
    if (verdict.refused) throw new Error(verdict.refused)
    if (verdict.keep) await deps.trust.keep(url, verdict.keep)
    const held = { at: now(), feed, signature: verdict.state }
    cache.set(url, held)
    return held
  }

  /**
   * The app a list links to, read from its own marketplace — which says what it is and signs it,
   * trusted from its first signed read — and offered under the list's identity: the list's
   * curation (where Localix vouches for the list), its words only where the app's own say nothing.
   * A link is followed once: the linked marketplace's own links are not.
   */
  async function followLink(
    list: MiniAppMarketplaceSource,
    link: MarketplaceLink,
    entry: MarketplaceApp,
    fresh: boolean,
  ): Promise<{ offer?: Offer; revocation?: Revocation; problem?: string }> {
    let held: Held | undefined
    try {
      held = await readHeld(link.url, { firstUse: true }, fresh)
    } catch (error) {
      held = cache.get(link.url)
      if (!held) return { problem: `${link.name}: ${errorMessage(error)}` }
    }
    const { marketplace } = held.feed
    const app = marketplace.apps.find((found) => found.name === link.name)
    if (!app) return { problem: `${link.name} is not in its marketplace (${link.url})` }
    const revoked = entry.revoked ?? app.revoked
    const revocation = revoked && revocationOf(link.name, list.name, revoked)
    if (takesBack(revoked, app.version)) return revocation ? { revocation } : {}
    const own = offerOf(app, {
      marketplace: list.name,
      publisher: { name: marketplace.owner.name, verified: false },
      source: list.url,
      from: link.url,
      signature: held.signature,
      curation: list.vouches ? entry.curation : {},
    })
    if (!own) return { problem: `${link.name} is not built in its marketplace (${link.url})` }
    const displayName = own.displayName ?? link.displayName
    const category = own.category ?? link.category
    const homepage = own.store.homepage ?? link.homepage
    const offer: Offer = {
      ...own,
      ...(displayName ? { displayName } : {}),
      description: own.description || link.description || '',
      ...(category ? { category } : {}),
      store: { ...own.store, ...(homepage ? { homepage } : {}) },
    }
    return { offer, ...(revocation ? { revocation } : {}) }
  }

  return async function read(opts: { fresh?: boolean } = {}): Promise<OfferRead> {
    const fresh = opts.fresh ?? false
    const result: OfferRead = {
      offers: new Map(),
      problems: [],
      failed: {},
      editorial: [],
      revocations: [],
      blocked: [],
    }
    const named = new Set<string>()
    for (const source of await deps.sources()) {
      if (named.has(source.name)) {
        result.problems.push(
          `Another marketplace is already called "${source.name}" (${source.url})`,
        )
        continue
      }
      named.add(source.name)
      let held: Held | undefined
      try {
        held = await readHeld(
          source.url,
          { pinned: source.pinned, firstUse: !source.builtIn, name: source.name },
          fresh,
        )
      } catch (error) {
        result.problems.push(`${source.name}: ${errorMessage(error)}`)
        result.failed[source.url] = errorMessage(error)
        held = cache.get(source.url)
      }
      if (!held) continue
      const { marketplace, links } = held.feed
      const publisher = { name: marketplace.owner.name, verified: source.vouches }
      const linked: Promise<Awaited<ReturnType<typeof followLink>>>[] = []
      for (const app of marketplace.apps) {
        if (app.revoked) result.revocations.push(revocationOf(app.name, source.name, app.revoked))
        const link = links.find((found) => found.name === app.name)
        if (link && !(app.revoked && !app.revoked.versions)) {
          linked.push(followLink(source, link, app, fresh))
          continue
        }
        if (takesBack(app.revoked, app.version)) continue
        const offer = offerOf(app, {
          marketplace: source.name,
          publisher,
          source: source.url,
          from: source.url,
          signature: held.signature,
          curation: source.vouches ? app.curation : {},
        })
        if (offer && !result.offers.has(offer.id)) result.offers.set(offer.id, offer)
      }
      for (const { offer, revocation, problem } of await Promise.all(linked)) {
        if (problem) result.problems.push(problem)
        if (revocation && !result.revocations.some((found) => found.id === revocation.id))
          result.revocations.push(revocation)
        if (offer && !result.offers.has(offer.id)) result.offers.set(offer.id, offer)
      }
      // Discover's rows and blocked archives are Localix's own word, like curation.
      if (!source.vouches) continue
      if (marketplace.collections.length)
        result.editorial.push({ source: source.url, collections: marketplace.collections })
      result.blocked.push(...marketplace.blockedArchives)
    }
    return result
  }
}
