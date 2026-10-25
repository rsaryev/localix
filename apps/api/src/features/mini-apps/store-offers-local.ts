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

import { listSubdirs } from '../ext/fs-discovery'
import { parseCatalogEditorial, type MiniAppCatalogEditorial } from './catalog-feed'
import {
  CATALOG_PICKS_FILE,
  type MiniAppStoreSource,
  type Offer,
  type OfferFile,
  type OfferStore,
} from './store-offer-types'

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

export async function localOffers(
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
