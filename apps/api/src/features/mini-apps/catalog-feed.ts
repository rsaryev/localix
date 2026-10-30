import { releaseMiniAppCatalog } from '@localixai/store'

import { readCatalogSignature, type CatalogSignature } from './catalog-signature'
import {
  catalogAppSchema,
  catalogV1Schema,
  catalogV2AppSchema,
  catalogV2Schema,
  picksFor,
  withoutEmpty,
  type MiniAppCatalogApp,
  type MiniAppCatalogEditorial,
  type MiniAppCatalogV2App,
} from './catalog-schema'

export type {
  MiniAppCatalogApp,
  MiniAppCatalogEditorial,
  MiniAppCatalogFile,
} from './catalog-schema'

/**
 * A catalog: one JSON file that lists mini apps (`catalog-schema.ts` has its two schemas). It may
 * be served over HTTPS (the hosted Localix catalog, a publisher's GitHub release, a list such as
 * Localix Community) or read from a folder (`file://`); an archive URL is resolved against the
 * catalog's own, so a catalog and its archives move together. Format:
 * `docs/extending/mini-app-publishing.md`.
 */

/** The newest catalog schema this Localix reads. */
export const MINI_APP_CATALOG_SCHEMA = 2

/**
 * An app a catalog lists by where it lives — another catalog — rather than as an archive of its
 * own. Its own catalog is the authority on it; what the list says (a description, a category)
 * fills in only what that catalog leaves out, as Claude Code merges a marketplace entry with the
 * plugin's own manifest.
 */
export interface MiniAppCatalogLink {
  name: string
  /** The catalog that holds it, resolved. */
  url: string
  description?: string
  category?: string
  homepage?: string
}

/**
 * A media URL against its catalog: HTTPS, or a file beside a catalog read from a folder. Anything
 * else (plain HTTP, a loopback service) is not fetched for a store page.
 */
function resolveMedia<T extends { url: string }>(file: T | undefined, catalogUrl: string) {
  if (!file) return undefined
  try {
    const url = new URL(file.url, catalogUrl)
    const allowed =
      url.protocol === 'https:' || (url.protocol === 'file:' && catalogUrl.startsWith('file:'))
    return allowed ? { ...file, url: url.href } : undefined
  } catch {
    return undefined
  }
}

/** A built app with its files' addresses resolved against its catalog. */
function resolvedApp(app: MiniAppCatalogApp, url: string): MiniAppCatalogApp {
  const screenshots = app.screenshots?.flatMap((shot) => resolveMedia(shot, url) ?? [])
  return withoutEmpty({
    ...app,
    icon: resolveMedia(app.icon, url),
    screenshots: screenshots?.length ? screenshots : undefined,
    readme: resolveMedia(app.readme, url),
    tags: app.tags?.length ? app.tags : undefined,
    archive: { ...app.archive, url: new URL(app.archive.url, url).href },
  })
}

/** Where a linked catalog is: HTTPS, or a file beside a catalog read from a folder. */
function linkedCatalogUrl(app: MiniAppCatalogV2App, catalogUrl: string): string | null {
  if (app.source.source === 'archive') return null
  if (app.source.source === 'github') return releaseMiniAppCatalog(app.source.repo)
  try {
    const url = new URL(app.source.url, catalogUrl)
    const allowed =
      url.protocol === 'https:' || (url.protocol === 'file:' && catalogUrl.startsWith('file:'))
    return allowed ? url.href : null
  } catch {
    return null
  }
}

type CatalogRead = {
  apps: MiniAppCatalogApp[]
  links: MiniAppCatalogLink[]
  editorial?: MiniAppCatalogEditorial
}

function readV1(body: unknown, url: string): CatalogRead | null {
  const parsed = catalogV1Schema.safeParse(body)
  if (!parsed.success) return null
  const apps = parsed.data.apps.flatMap((raw) => {
    const app = catalogAppSchema.safeParse(raw)
    return app.success ? [resolvedApp(app.data, url)] : []
  })
  const { editorial } = parsed.data
  return {
    apps,
    links: [],
    ...(editorial ? { editorial: { collections: editorial.collections } } : {}),
  }
}

/**
 * A schema 2 catalog: its built apps read as schema 1's (the owner publishes them, Localix's picks
 * from `metadata.localix` set on each), and its links to other catalogs.
 */
function readV2(body: unknown, url: string): CatalogRead | null {
  const parsed = catalogV2Schema.safeParse(body)
  if (!parsed.success) return null
  const picks = parsed.data.metadata?.localix
  const apps: MiniAppCatalogApp[] = []
  const links: MiniAppCatalogLink[] = []
  for (const raw of parsed.data.apps) {
    const entry = catalogV2AppSchema.safeParse(raw)
    if (!entry.success) continue
    const { source, ...app } = entry.data
    if (source.source === 'archive') {
      const built = catalogAppSchema.safeParse({
        ...app,
        publisher: { name: parsed.data.owner.name, verified: true },
        archive: { url: source.url, bytes: source.bytes, sha256: source.sha256 },
        ...picksFor(app.name, picks),
      })
      if (built.success) apps.push(resolvedApp(built.data, url))
      continue
    }
    const linked = linkedCatalogUrl(entry.data, url)
    if (linked)
      links.push(
        withoutEmpty({
          name: app.name,
          url: linked,
          description: app.description || undefined,
          category: app.category,
          homepage: app.homepage,
        }),
      )
  }
  return {
    apps,
    links,
    ...(picks?.collections.length ? { editorial: { collections: picks.collections } } : {}),
  }
}

/**
 * The apps a catalog lists. One entry that does not read is left out — a single bad row must
 * not hide a whole catalog — while a catalog that cannot be fetched or is not one throws.
 */
export async function readMiniAppCatalog(
  url: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<MiniAppCatalogApp[]> {
  return (await readMiniAppCatalogFeed(url, options)).apps
}

/** The most redirects a catalog's address may take. */
const REDIRECTS_MAX = 10

/**
 * Fetch a catalog, following its redirects one by one, and say where its signature is: beside the
 * last address on the way that still names the catalog's file. GitHub's `releases/latest/…`
 * leads to the release's own address and then to storage whose address names nothing (a `.sig`
 * appended there only lands in its query, and the catalog comes back again); `latest` itself may
 * by then be a newer release.
 */
async function fetchCatalog(
  url: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<{ response: Response; signedAt: string }> {
  const file = (address: string) => new URL(address).pathname.split('/').at(-1)
  let at = url
  let signedAt = url
  for (let hop = 0; ; hop++) {
    const response = await (options.fetchImpl ?? fetch)(at, {
      signal: options.signal,
      redirect: 'manual',
    })
    const to = response.status >= 300 && response.status < 400 && response.headers.get('location')
    if (!to) return { response, signedAt }
    if (hop === REDIRECTS_MAX) throw new Error(`more than ${REDIRECTS_MAX} redirects`)
    at = new URL(to, at).href
    if (file(at) === file(url)) signedAt = at
  }
}

/**
 * A catalog's built apps, its links to other catalogs, the picks it carries for Discover, and the
 * signature beside it, checked against the exact bytes the catalog was served as
 * (`catalog-signature.ts`).
 */
export async function readMiniAppCatalogFeed(
  url: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<CatalogRead & { signature: CatalogSignature }> {
  const where = url.startsWith('file:') ? url : new URL(url).host
  let response: Response
  let signedAt: string
  try {
    ;({ response, signedAt } = await fetchCatalog(url, options))
  } catch (error) {
    throw new Error(
      `Could not reach the mini app catalog at ${where}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) throw new Error(`The mini app catalog at ${where} answered ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error(`The mini app catalog at ${where} is not JSON`)
  }
  const read = readV2(body, url) ?? readV1(body, url)
  if (!read)
    throw new Error(
      `${where} is not a mini app catalog (schema 1 or ${MINI_APP_CATALOG_SCHEMA} with an apps list)`,
    )
  const signature = await readCatalogSignature(signedAt, bytes, options)
  return { ...read, signature }
}
