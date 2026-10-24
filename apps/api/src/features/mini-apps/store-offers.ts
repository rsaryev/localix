import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'
import {
  isAppRelativePath,
  MINI_APP_ICON_TYPES,
  MINI_APP_SCREENSHOT_TYPES,
  MINI_APP_TAG_RE,
  mediaExtension,
} from '@localixai/mini-app-sdk/manifest-media'

import { errorMessage } from '../../lib/errors'
import { listSubdirs } from '../ext/fs-discovery'
import {
  parseCatalogEditorial,
  readMiniAppCatalogFeed,
  type MiniAppCatalogEditorial,
} from './catalog-feed'

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
  | { kind: 'local'; root: string; publisher: MiniAppPublisher; vouches?: boolean }
  | { kind: 'catalog'; url: string; vouches: boolean }

/**
 * Beside the apps of a local source Localix vouches for (the staged first-party folder): which of
 * them the store features and which a new installation gets on its own — the same lists the
 * release writes into its catalog (`scripts/pack-mini-apps.mjs`).
 */
export const CATALOG_PICKS_FILE = 'catalog-picks.json'

/**
 * One file of an app's store page: a path in a local app's folder, or a catalog's pinned file. It
 * reaches a client only as a host address (`store-media.ts`), never as where it lives.
 */
export type OfferFile =
  | { from: 'local'; path: string; type: string }
  | { from: 'catalog'; url: string; bytes: number; sha256: string; type: string }

/** What the store page of an app shows beside its row. */
export interface OfferStore {
  icon?: OfferFile
  screenshots: (OfferFile & { caption?: string })[]
  readme?: OfferFile
  tags: string[]
  homepage?: string
  license?: string
  author?: string
  /** In the Featured group; set only by a catalog Localix vouches for. */
  featured?: boolean
  /** Installed on its own on a new installation; set only by a catalog Localix vouches for. */
  recommended?: boolean
  surfaces?: string[]
  commands?: string[]
}

/** What an app is, as an offer shows it. */
export interface OfferMeta {
  name: string
  displayName?: string
  description: string
  category?: string
  version?: string
  apiVersion?: number
  publisher: MiniAppPublisher
  /** The catalog it comes from, as the catalog list names it (`catalogs.ts`). */
  source: string
  store: OfferStore
}

/** One app a source offers, and how to get it. */
export type Offer = OfferMeta &
  (
    | { from: 'local'; dir: string }
    | { from: 'catalog'; catalog: string; archive: { url: string; bytes: number; sha256: string } }
  )

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

const README_FILE = 'README.md'

/** A file a local app's manifest names, typed by its extension when that kind is allowed. */
function localFile(path: unknown, types: Readonly<Record<string, string>>): OfferFile | undefined {
  if (typeof path !== 'string' || !isAppRelativePath(path)) return undefined
  const type = types[mediaExtension(path)]
  return type ? { from: 'local', path, type } : undefined
}

/** The store fields of a local app, read from its manifest and folder as written. */
async function localStore(dir: string, manifest: Record<string, unknown>): Promise<OfferStore> {
  const shots = Array.isArray(manifest.screenshots) ? manifest.screenshots : []
  const author = text(manifest.author) ?? text((manifest.author as { name?: unknown })?.name)
  const readme = await fs.stat(join(dir, README_FILE)).catch(() => null)
  const commands =
    manifest.commands && typeof manifest.commands === 'object' ? Object.keys(manifest.commands) : []
  return {
    ...(localFile(manifest.icon, MINI_APP_ICON_TYPES)
      ? { icon: localFile(manifest.icon, MINI_APP_ICON_TYPES) }
      : {}),
    screenshots: shots.flatMap((shot) => {
      const file = localFile(shot?.path, MINI_APP_SCREENSHOT_TYPES)
      return file ? [{ ...file, ...(text(shot.caption) ? { caption: shot.caption } : {}) }] : []
    }),
    ...(readme?.isFile()
      ? { readme: { from: 'local', path: README_FILE, type: 'text/markdown' } as const }
      : {}),
    tags: Array.isArray(manifest.tags)
      ? manifest.tags.filter(
          (tag): tag is string => typeof tag === 'string' && MINI_APP_TAG_RE.test(tag),
        )
      : [],
    ...(text(manifest.homepage) ? { homepage: text(manifest.homepage) } : {}),
    ...(text(manifest.license) ? { license: text(manifest.license) } : {}),
    ...(author ? { author } : {}),
    ...(Array.isArray(manifest.surfaces) ? { surfaces: manifest.surfaces.map(String) } : {}),
    ...(commands.length ? { commands } : {}),
  }
}

export async function readManifest(dir: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(join(dir, MINI_APP_MANIFEST_FILE), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** The picks beside a local source's apps, only when Localix vouches for the source. */
async function localPicks(source: Extract<MiniAppStoreSource, { kind: 'local' }>): Promise<{
  featured: Set<string>
  recommended: Set<string>
  editorial?: MiniAppCatalogEditorial
}> {
  const none = { featured: new Set<string>(), recommended: new Set<string>() }
  if (!source.vouches) return none
  try {
    const parsed = JSON.parse(await fs.readFile(join(source.root, CATALOG_PICKS_FILE), 'utf8'))
    const names = (value: unknown) =>
      new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])
    const editorial = parseCatalogEditorial(parsed)
    return {
      featured: names(parsed?.featured),
      recommended: names(parsed?.recommended),
      ...(editorial ? { editorial } : {}),
    }
  } catch {
    return none
  }
}

async function localOffers(
  source: Extract<MiniAppStoreSource, { kind: 'local' }>,
): Promise<{ offers: Offer[]; editorial?: MiniAppCatalogEditorial }> {
  const offers: Offer[] = []
  const picks = await localPicks(source)
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
      source: pathToFileURL(source.root).href,
      store: {
        ...(await localStore(dir, manifest)),
        ...(picks.featured.has(name) ? { featured: true } : {}),
        ...(picks.recommended.has(name) ? { recommended: true } : {}),
      },
      from: 'local',
      dir,
    })
  }
  return { offers, ...(picks.editorial ? { editorial: picks.editorial } : {}) }
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
    /** Each vouched source's picks for Discover, by the source's address. */
    editorial: Array<{ source: string; editorial: MiniAppCatalogEditorial }>
  }> {
    const offers = new Map<string, Offer>()
    const editorial: Array<{ source: string; editorial: MiniAppCatalogEditorial }> = []
    const problems: string[] = []
    for (const source of await deps.sources()) {
      let found: { offers: Offer[]; editorial?: MiniAppCatalogEditorial }
      try {
        found =
          source.kind === 'local'
            ? await localOffers(source)
            : await catalogOffers(source, opts.fresh ?? false)
      } catch (error) {
        problems.push(errorMessage(error))
        found =
          source.kind === 'catalog' ? (cache.get(source.url) ?? { offers: [] }) : { offers: [] }
      }
      for (const offer of found.offers) if (!offers.has(offer.name)) offers.set(offer.name, offer)
      if (found.editorial)
        editorial.push({
          source: source.kind === 'catalog' ? source.url : pathToFileURL(source.root).href,
          editorial: found.editorial,
        })
    }
    return { offers, problems, editorial }
  }
}
