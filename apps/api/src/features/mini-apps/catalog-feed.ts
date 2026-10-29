import { z } from 'zod'
import {
  MINI_APP_SCREENSHOTS_MAX,
  MINI_APP_TAG_RE,
  MINI_APP_TAGS_MAX,
  MINI_APP_NAME_RE,
} from '@localixai/mini-app-sdk/manifest-primitives'
import { miniAppFileAssociationSchema } from '@localixai/mini-app-sdk/manifest'
import { sourceSuitsSchema } from '@localixai/store'

import { readCatalogSignature, type CatalogSignature } from './catalog-signature'

/**
 * A catalog: one `catalog.json` that lists mini apps and where each one's archive is. It may be
 * served over HTTPS (the hosted Localix catalog, a publisher's GitHub release) or read from a
 * folder (`file://`); an archive URL is resolved against the catalog's own, so a catalog and its
 * archives move together. Format: `docs/extending/mini-app-publishing.md`.
 */

export const MINI_APP_CATALOG_SCHEMA = 1

const SHA256 = /^[a-f0-9]{64}$/
/** The most kinds of file one app may say it opens. */
const FILE_KINDS_MAX = 64

/** A file a catalog publishes beside its archives, pinned like them by size and sha256. */
const pinnedFileSchema = z.object({
  url: z.string().min(1),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(SHA256),
})
const pinnedImageSchema = pinnedFileSchema.extend({ type: z.string().min(1) })

/**
 * The store fields of an entry (`docs/extending/mini-app-publishing.md`). All optional, and each
 * one that does not read is dropped alone: an older reader ignores them, and a bad icon must not
 * hide the app it belongs to.
 */
const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined)
const storeFieldsSchema = {
  icon: optional(pinnedImageSchema),
  screenshots: optional(
    z
      .array(z.unknown())
      .transform((shots) =>
        shots.flatMap((shot) => {
          const parsed = pinnedImageSchema
            .extend({ caption: z.string().max(140).optional() })
            .safeParse(shot)
          return parsed.success ? [parsed.data] : []
        }),
      )
      .transform((shots) => shots.slice(0, MINI_APP_SCREENSHOTS_MAX)),
  ),
  readme: optional(pinnedFileSchema),
  tags: optional(
    z
      .array(z.unknown())
      .transform((tags) =>
        tags
          .filter((tag): tag is string => typeof tag === 'string' && MINI_APP_TAG_RE.test(tag))
          .slice(0, MINI_APP_TAGS_MAX),
      ),
  ),
  homepage: optional(z.string().url().startsWith('https://')),
  license: optional(z.string().max(64)),
  author: optional(z.string().max(120)),
  /** Shown in the store's Featured group, for the catalog Localix vouches for only. */
  featured: optional(z.boolean()),
  /**
   * Installed on its own, once, on a new installation (`recommended.ts`) — for the catalog Localix
   * vouches for only.
   */
  recommended: optional(z.boolean()),
  /** What it is for (`Listing.suits`), for recommendations — the catalog Localix vouches for only. */
  suits: sourceSuitsSchema,
  surfaces: optional(z.array(z.string().max(32)).max(16)),
  commands: optional(z.array(z.string().max(64)).max(64)),
  /**
   * The kinds of file it opens: its manifest's `fileAssociations`, as the packer copies them. Read
   * as the kinds alone (`docx`, `request.json`), each declaration that does not parse dropped, and
   * one ranked `None` left out: the app opens it but asks not to be offered for it (a reader that
   * also shows Markdown, which the editor opens).
   */
  fileAssociations: optional(
    z.array(z.unknown()).transform((entries) => [
      ...new Set(
        entries
          .flatMap((entry) => {
            const declared = miniAppFileAssociationSchema.safeParse(entry).data
            return declared && declared.rank !== 'None' ? declared.ext : []
          })
          .slice(0, FILE_KINDS_MAX),
      ),
    ]),
  ),
}

const catalogAppSchema = z.object({
  name: z.string().regex(MINI_APP_NAME_RE),
  displayName: z.string().optional(),
  description: z.string().default(''),
  category: z.string().optional(),
  version: z.string().min(1),
  /** The mini app SDK contract it was built against; a newer one waits for a newer Localix. */
  apiVersion: z.number().int().positive().optional(),
  publisher: z.object({ name: z.string().min(1), verified: z.boolean().default(false) }),
  archive: z.object({
    url: z.string().min(1),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(SHA256),
  }),
  ...storeFieldsSchema,
})
export type MiniAppCatalogApp = z.infer<typeof catalogAppSchema>
export type MiniAppCatalogFile = z.infer<typeof pinnedFileSchema> & { type?: string }

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

const withoutEmpty = <T extends Record<string, unknown>>(record: T): T =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T

/**
 * Discover's picks a catalog may carry (`docs/internals/store.md`): collections whose
 * items are app names, or `<kind>:<id>` for another kind. Each that does not read is dropped alone.
 */
const collectionSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  subtitle: optional(z.string().max(240)),
  style: z.enum(['row', 'grid']).catch('row'),
  items: z
    .array(z.unknown())
    .transform((items) =>
      items.filter((item): item is string => typeof item === 'string').slice(0, 48),
    ),
})
const editorialSchema = z.object({
  collections: optional(z.array(z.unknown())).transform((all) =>
    (all ?? []).flatMap((raw) => {
      const parsed = collectionSchema.safeParse(raw)
      return parsed.success ? [withoutEmpty(parsed.data)] : []
    }),
  ),
})
export type MiniAppCatalogEditorial = z.infer<typeof editorialSchema>

const catalogSchema = z.object({
  schema: z.literal(MINI_APP_CATALOG_SCHEMA),
  apps: z.array(z.unknown()),
  editorial: optional(editorialSchema),
})

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

/**
 * A catalog's apps, the picks it carries for Discover, and the signature beside it, checked
 * against the exact bytes the catalog was served as (`catalog-signature.ts`).
 */
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

export async function readMiniAppCatalogFeed(
  url: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<{
  apps: MiniAppCatalogApp[]
  editorial?: MiniAppCatalogEditorial
  signature: CatalogSignature
}> {
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
  const parsed = catalogSchema.safeParse(body)
  if (!parsed.success)
    throw new Error(
      `${where} is not a mini app catalog (schema ${MINI_APP_CATALOG_SCHEMA} with an apps list)`,
    )
  const { editorial } = parsed.data
  const apps = parsed.data.apps.flatMap((raw) => {
    const app = catalogAppSchema.safeParse(raw)
    if (!app.success) return []
    const screenshots = app.data.screenshots?.flatMap((shot) => resolveMedia(shot, url) ?? [])
    return [
      withoutEmpty({
        ...app.data,
        icon: resolveMedia(app.data.icon, url),
        screenshots: screenshots?.length ? screenshots : undefined,
        readme: resolveMedia(app.data.readme, url),
        tags: app.data.tags?.length ? app.data.tags : undefined,
        archive: { ...app.data.archive, url: new URL(app.data.archive.url, url).href },
      }),
    ]
  })
  const signature = await readCatalogSignature(signedAt, bytes, options)
  return {
    apps,
    ...(editorial ? { editorial: { collections: editorial.collections } } : {}),
    signature,
  }
}
