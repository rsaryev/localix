import type { KeyObject } from 'node:crypto'

import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'
import { signMarketplace } from '@localixai/mini-app-sdk/marketplace-signature'

import { packMiniAppFiles } from '../features/mini-apps/archive'
import type { KeptTrust } from '../features/mini-apps/marketplace-trust'
import type { MiniAppMarketplaceSource } from '../features/mini-apps/marketplaces'

/** One app a fixture marketplace builds. Every field but the name has a default. */
export interface MarketplaceEntry {
  name: string
  version?: string
  displayName?: string
  description?: string
  category?: string
  apiVersion?: number
  /** The archive's checksum is wrong, so the install is refused. */
  corrupt?: boolean
  featured?: boolean
  installByDefault?: boolean
  /** What the keeper suggests it for, as it is written. */
  suggestFor?: unknown
  /** The kinds of file it opens, as the manifest writes them; carried as it is written. */
  fileAssociations?: unknown
  revoked?: { reason: string; versions?: string[] }
  tags?: string[]
  surfaces?: string[]
  commands?: string[]
  license?: string
  author?: string
  homepage?: string
  /** A README the marketplace pins, as Markdown. */
  readme?: string
  /** More files in the archive, by path. */
  files?: Record<string, string>
}

/** An app the marketplace lists by the marketplace it lives in. */
export interface MarketplaceLinkEntry {
  name: string
  link: { source: 'github'; repo: string } | { source: 'url'; url: string }
  description?: string
  category?: string
  homepage?: string
  featured?: boolean
  revoked?: { reason: string; versions?: string[] }
}

export const DEFAULT_MARKETPLACE_URL =
  'https://marketplace.example.test/mini-apps/mini-app-marketplace.json'

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')

/**
 * A released marketplace (`docs/extending/mini-app-marketplace.md`): its
 * `mini-app-marketplace.json` and the archives it names, served by a stub `fetch`. Everything is
 * read on every request, so a test raises a version, adds an app, revokes one or moves the
 * release on after the store was built. `fetched` lists every URL asked for.
 */
export function hostedMiniAppMarketplace(
  initial: (MarketplaceEntry | MarketplaceLinkEntry)[] = [],
  opts: {
    url?: string
    name?: string
    owner?: string
    published?: string
    collections?: unknown
    blockedArchives?: unknown
    /** Publishes `<marketplace>.sig`, one signature per key; a test may change them later. */
    signWith?: KeyObject[]
    /** The `signingKeys` the release names for the next one. */
    signingKeys?: string[]
  } = {},
) {
  const url = opts.url ?? DEFAULT_MARKETPLACE_URL
  const apps = [...initial]
  const fetched: string[] = []
  const release = {
    name: opts.name ?? 'acme',
    owner: opts.owner ?? 'Acme',
    published: opts.published ?? '2026-10-30T09:00:00.000Z',
    signWith: opts.signWith ?? [],
    signingKeys: opts.signingKeys,
    collections: opts.collections,
    blockedArchives: opts.blockedArchives,
  }
  // Packed once per content: a tarball records the time it was packed, so packing on every request
  // served an archive whose sha256 was not the one the marketplace read a second earlier listed.
  const packed = new Map<string, Promise<Uint8Array>>()
  const pack = (files: Parameters<typeof packMiniAppFiles>[0]) => {
    const key = JSON.stringify(files)
    let archive = packed.get(key)
    if (!archive) {
      archive = packMiniAppFiles(files)
      packed.set(key, archive)
    }
    return archive
  }

  async function built(app: MarketplaceEntry, files: Map<string, Uint8Array>) {
    const version = app.version ?? '1.0.0'
    const archive = await pack({
      [MINI_APP_MANIFEST_FILE]: JSON.stringify({ name: app.name, version }),
      'guide.md': `# ${app.name} ${version}`,
      ...app.files,
    })
    files.set(`${app.name}-${version}.tar.gz`, archive)
    const readme = app.readme ? new TextEncoder().encode(app.readme) : undefined
    if (readme) files.set(`${app.name}-readme.md`, readme)
    const { name, displayName, category, apiVersion, featured, installByDefault } = app
    return {
      name,
      description: app.description ?? `${name} app`,
      version,
      source: {
        source: 'archive',
        url: `${name}-${version}.tar.gz`,
        bytes: archive.byteLength,
        sha256: app.corrupt ? 'f'.repeat(64) : sha256(archive),
      },
      ...(displayName ? { displayName } : {}),
      ...(category ? { category } : {}),
      ...(apiVersion ? { apiVersion } : {}),
      ...(featured ? { featured } : {}),
      ...(installByDefault ? { installByDefault } : {}),
      ...(app.suggestFor ? { suggestFor: app.suggestFor } : {}),
      ...(app.fileAssociations ? { fileAssociations: app.fileAssociations } : {}),
      ...(app.revoked ? { revoked: app.revoked } : {}),
      ...(app.tags ? { tags: app.tags } : {}),
      ...(app.surfaces ? { surfaces: app.surfaces } : {}),
      ...(app.commands ? { commands: app.commands } : {}),
      ...(app.license ? { license: app.license } : {}),
      ...(app.author ? { author: app.author } : {}),
      ...(app.homepage ? { homepage: app.homepage } : {}),
      ...(readme
        ? {
            readme: {
              url: `${name}-readme.md`,
              bytes: readme.byteLength,
              sha256: sha256(readme),
            },
          }
        : {}),
    }
  }

  async function serve() {
    const files = new Map<string, Uint8Array>()
    const listed: Record<string, unknown>[] = []
    for (const app of apps) {
      if ('link' in app) {
        const { link, ...rest } = app
        listed.push({ ...rest, source: link })
      } else listed.push(await built(app, files))
    }
    const text = JSON.stringify({
      schema: 3,
      name: release.name,
      owner: { name: release.owner },
      ...(release.published ? { published: release.published } : {}),
      ...(release.signingKeys ? { signingKeys: release.signingKeys } : {}),
      apps: listed,
      ...(release.collections ? { collections: release.collections } : {}),
      ...(release.blockedArchives ? { blockedArchives: release.blockedArchives } : {}),
    })
    return { files, text }
  }

  /** The archive bytes an app is served as, for a test that blocks one by its sha256. */
  async function archiveOf(name: string): Promise<{ sha256: string }> {
    const { files } = await serve()
    const app = apps.find((found) => found.name === name) as MarketplaceEntry
    const bytes = files.get(`${name}-${app.version ?? '1.0.0'}.tar.gz`)!
    return { sha256: sha256(bytes) }
  }

  const fetchImpl = (async (input: string | URL | Request) => {
    const asked = new URL(String(input instanceof Request ? input.url : input))
    fetched.push(asked.href)
    const { files, text } = await serve()
    if (asked.href === url)
      return new Response(text, { headers: { 'content-type': 'application/json' } })
    if (asked.href === `${url}.sig`)
      return release.signWith.length
        ? new Response(signMarketplace(new TextEncoder().encode(text), release.signWith))
        : new Response('missing', { status: 404 })
    const bytes = files.get(asked.pathname.split('/').pop() ?? '')
    return bytes
      ? new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]))
      : new Response('missing', { status: 404 })
  }) as unknown as typeof fetch

  /** The app built beside the marketplace by this name, to change it after the store was built. */
  const app = (name: string) => apps.find((found) => found.name === name) as MarketplaceEntry

  return { url, apps, app, fetchImpl, fetched, release, archiveOf }
}

/** One `fetch` that answers for several fixture marketplaces, each at its own address. */
export function servingAll(...hosts: { url: string; fetchImpl: typeof fetch }[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const asked = String(input instanceof Request ? input.url : input)
    const base = (url: string) => url.slice(0, url.lastIndexOf('/') + 1)
    const host = hosts.find((found) => asked.startsWith(base(found.url)))
    return host ? host.fetchImpl(input as string) : new Response('missing', { status: 404 })
  }) as unknown as typeof fetch
}

/** What Localix keeps to judge marketplaces' signatures, in memory (`marketplaces.ts` keeps it in the database). */
export function memoryTrust() {
  const kept = new Map<string, KeptTrust>()
  return {
    kept,
    get: async (url: string) => kept.get(url),
    keep: async (url: string, trust: KeptTrust) => void kept.set(url, trust),
  }
}

/** One marketplace the store reads, as `marketplaces.ts` lists it. */
export const marketplaceSource = (
  host: { url: string; release: { name: string } },
  extra: Partial<MiniAppMarketplaceSource> = {},
): MiniAppMarketplaceSource => ({
  url: host.url,
  name: host.release.name,
  vouches: false,
  builtIn: false,
  ...extra,
})
