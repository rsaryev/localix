import type { KeyObject } from 'node:crypto'

import { packMiniAppFiles } from '../features/mini-apps/archive'
import { signCatalog } from '../features/mini-apps/catalog-signature'

/** One app a fixture catalog lists. Every field but the name has a default. */
export interface CatalogEntry {
  name: string
  version?: string
  displayName?: string
  description?: string
  category?: string
  apiVersion?: number
  /** Whether the publisher is Localix (the default) or a stranger named "Someone". */
  verified?: boolean
  /** The archive's checksum is wrong, so the install is refused. */
  corrupt?: boolean
  featured?: boolean
  recommended?: boolean
  /** What the catalog says it is for (`Listing.suits`), as it is written. */
  suits?: unknown
  /** The kinds of file it opens, as `mini-app.json` writes them; carried as it is written. */
  fileAssociations?: unknown
  tags?: string[]
  surfaces?: string[]
  commands?: string[]
  license?: string
  author?: string
  homepage?: string
  /** A README the catalog pins, as Markdown. */
  readme?: string
  /** More files in the archive, by path. */
  files?: Record<string, string>
}

export const DEFAULT_CATALOG_URL = 'https://catalog.example.test/mini-apps/mini-app-catalog.json'

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')

/**
 * A hosted catalog: its `mini-app-catalog.json` and the archives it names, served by a stub
 * `fetch`. `apps` is read on every request, so a test raises a version or adds an app after the
 * store was built. `fetched` lists every URL asked for.
 */
export function hostedMiniAppCatalog(
  initial: CatalogEntry[] = [],
  opts: {
    url?: string
    editorial?: unknown
    /** Publishes `<catalog>.sig`, made with this key; a test may set or swap it later. */
    signWith?: KeyObject
  } = {},
) {
  const url = opts.url ?? DEFAULT_CATALOG_URL
  const apps = [...initial]
  const fetched: string[] = []
  const signing: { key?: KeyObject } = { key: opts.signWith }
  // Packed once per content: a tarball records the time it was packed, so packing on every request
  // served an archive whose sha256 was not the one the catalog read a second earlier listed.
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

  async function serve() {
    const files = new Map<string, Uint8Array>()
    const listed: Record<string, unknown>[] = []
    for (const app of apps) {
      const version = app.version ?? '1.0.0'
      const archive = await pack({
        'mini-app.json': JSON.stringify({ name: app.name, version }),
        'guide.md': `# ${app.name} ${version}`,
        ...app.files,
      })
      files.set(`${app.name}-${version}.tar.gz`, archive)
      const readme = app.readme ? new TextEncoder().encode(app.readme) : undefined
      if (readme) files.set(`${app.name}-readme.md`, readme)
      const { name, displayName, category, apiVersion, featured, recommended } = app
      listed.push({
        name,
        description: app.description ?? `${name} app`,
        version,
        publisher: {
          name: app.verified === false ? 'Someone' : 'Localix',
          verified: app.verified !== false,
        },
        archive: {
          url: `${name}-${version}.tar.gz`,
          bytes: archive.byteLength,
          sha256: app.corrupt ? 'f'.repeat(64) : sha256(archive),
        },
        ...(displayName ? { displayName } : {}),
        ...(category ? { category } : {}),
        ...(apiVersion ? { apiVersion } : {}),
        ...(featured ? { featured } : {}),
        ...(recommended ? { recommended } : {}),
        ...(app.suits ? { suits: app.suits } : {}),
        ...(app.fileAssociations ? { fileAssociations: app.fileAssociations } : {}),
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
      })
    }
    return { files, listed }
  }

  const fetchImpl = (async (input: string | URL | Request) => {
    const asked = new URL(String(input instanceof Request ? input.url : input))
    fetched.push(asked.href)
    const { files, listed } = await serve()
    const text = JSON.stringify({
      schema: 1,
      apps: listed,
      ...(opts.editorial ? { editorial: opts.editorial } : {}),
    })
    if (asked.href === url)
      return new Response(text, { headers: { 'content-type': 'application/json' } })
    if (asked.href === `${url}.sig`)
      return signing.key
        ? new Response(signCatalog(new TextEncoder().encode(text), signing.key))
        : new Response('missing', { status: 404 })
    const bytes = files.get(asked.pathname.split('/').pop() ?? '')
    return bytes
      ? new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]))
      : new Response('missing', { status: 404 })
  }) as unknown as typeof fetch

  return { url, apps, fetchImpl, fetched, signing }
}
