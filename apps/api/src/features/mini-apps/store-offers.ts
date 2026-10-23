import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'

import { errorMessage } from '../../lib/errors'
import { listSubdirs } from '../ext/fs-discovery'
import { readMiniAppCatalog } from './catalog-feed'

/** Who publishes an app, and whether Localix vouches for them. */
export interface MiniAppPublisher {
  name: string
  verified: boolean
}

/**
 * Where offers come from.
 * - `local`: a folder of built apps — in development, the checkout's staged `mini-apps/`, so a
 *   change is installed without a release. Every app in it has the source's publisher.
 * - `catalog`: a `catalog.json` over HTTPS or `file://`. Its publishers are verified only when the
 *   source `vouches` — the hosted Localix catalog does; one a person added does not.
 */
export type MiniAppStoreSource =
  | { kind: 'local'; root: string; publisher: MiniAppPublisher }
  | { kind: 'catalog'; url: string; vouches: boolean }

/** What an app is, as an offer shows it. */
export interface OfferMeta {
  name: string
  displayName?: string
  description: string
  category?: string
  version?: string
  apiVersion?: number
  publisher: MiniAppPublisher
}

/** One app a source offers, and how to get it. */
export type Offer = OfferMeta &
  (
    | { from: 'local'; dir: string }
    | { from: 'catalog'; catalog: string; archive: { url: string; bytes: number; sha256: string } }
  )

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

export async function readManifest(dir: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(join(dir, MINI_APP_MANIFEST_FILE), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function localOffers(
  source: Extract<MiniAppStoreSource, { kind: 'local' }>,
): Promise<Offer[]> {
  const offers: Offer[] = []
  for (const folder of await listSubdirs(source.root)) {
    if (folder.startsWith('.')) continue
    const dir = join(source.root, folder)
    const manifest = await readManifest(dir)
    const name = text(manifest?.name)
    // A private app (the authoring template) is not an offer.
    if (!manifest || !name || manifest.private === true) continue
    offers.push({
      name,
      ...(text(manifest.displayName) ? { displayName: text(manifest.displayName) } : {}),
      description: text(manifest.description) ?? '',
      ...(text(manifest.category) ? { category: text(manifest.category) } : {}),
      ...(text(manifest.version) ? { version: text(manifest.version) } : {}),
      ...(typeof manifest.apiVersion === 'number' ? { apiVersion: manifest.apiVersion } : {}),
      publisher: source.publisher,
      from: 'local',
      dir,
    })
  }
  return offers
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
}) {
  const ttl = deps.ttlMs ?? 10 * 60_000
  const now = deps.now ?? Date.now
  const cache = new Map<string, { at: number; offers: Offer[] }>()

  async function catalogOffers(
    source: Extract<MiniAppStoreSource, { kind: 'catalog' }>,
    fresh: boolean,
  ): Promise<Offer[]> {
    const cached = cache.get(source.url)
    if (cached && !fresh && now() - cached.at < ttl) return cached.offers
    const apps = await readMiniAppCatalog(source.url, { fetchImpl: deps.fetchImpl })
    const offers = apps.map((app): Offer => ({
      name: app.name,
      ...(app.displayName ? { displayName: app.displayName } : {}),
      description: app.description,
      ...(app.category ? { category: app.category } : {}),
      version: app.version,
      ...(app.apiVersion ? { apiVersion: app.apiVersion } : {}),
      publisher: { name: app.publisher.name, verified: source.vouches && app.publisher.verified },
      from: 'catalog',
      catalog: source.url,
      archive: app.archive,
    }))
    cache.set(source.url, { at: now(), offers })
    return offers
  }

  /** Every offer by name — the first source to offer a name wins it — and what could not be read. */
  return async function read(
    opts: { fresh?: boolean } = {},
  ): Promise<{ offers: Map<string, Offer>; problems: string[] }> {
    const offers = new Map<string, Offer>()
    const problems: string[] = []
    for (const source of await deps.sources()) {
      let found: Offer[]
      try {
        found =
          source.kind === 'local'
            ? await localOffers(source)
            : await catalogOffers(source, opts.fresh ?? false)
      } catch (error) {
        problems.push(errorMessage(error))
        found = source.kind === 'catalog' ? (cache.get(source.url)?.offers ?? []) : []
      }
      for (const offer of found) if (!offers.has(offer.name)) offers.set(offer.name, offer)
    }
    return { offers, problems }
  }
}
