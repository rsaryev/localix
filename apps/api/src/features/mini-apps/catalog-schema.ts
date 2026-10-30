import { z } from 'zod'
import {
  MINI_APP_SCREENSHOTS_MAX,
  MINI_APP_TAG_RE,
  MINI_APP_TAGS_MAX,
  MINI_APP_NAME_RE,
} from '@localixai/mini-app-sdk/manifest-primitives'
import { miniAppFileAssociationSchema } from '@localixai/mini-app-sdk/manifest'
import { sourceSuitsSchema } from '@localixai/store'

/**
 * What a mini app catalog's JSON may say (`docs/extending/mini-app-publishing.md`, "Catalog").
 *
 * Schema 2 is a marketplace in the shape of Claude Code's `marketplace.json`: a `name`, an
 * `owner`, `metadata` (Localix's picks under `metadata.localix`) and `apps`, each with a `source`
 * that says where the app is — `archive` (a built app beside the catalog, pinned by sha256) or
 * another catalog (`github`: the one a repository's latest release publishes; `url`: one at an
 * address). Schema 1, a flat list of built apps, is still read.
 */

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
 * Each field that does not read is dropped alone: an older reader ignores it, and a bad icon must
 * not hide the app it belongs to.
 */
export const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined)

/** What an app's store page shows, beside its row: facts any catalog may state. */
const factFieldsSchema = {
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
  /** A name, or Claude Code's `{ name }`. */
  author: optional(
    z
      .union([z.string(), z.object({ name: z.string() }).transform(({ name }) => name)])
      .pipe(z.string().min(1).max(120)),
  ),
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

/** Localix's picks, honoured only from the catalog Localix vouches for (`store-offers.ts`). */
const pickFieldsSchema = {
  /** Shown in the store's Featured group. */
  featured: optional(z.boolean()),
  /** Installed on its own, once, on a new installation (`recommended.ts`). */
  recommended: optional(z.boolean()),
  /** What it is for (`Listing.suits`), for recommendations. */
  suits: sourceSuitsSchema,
}

const archiveSchema = z.object({
  url: z.string().min(1),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(SHA256),
})

const identitySchema = {
  name: z.string().regex(MINI_APP_NAME_RE),
  displayName: z.string().optional(),
  description: z.string().default(''),
  category: z.string().optional(),
}

/** A built app, as Localix installs it: schema 1's entry, and what schema 2's reads as. */
export const catalogAppSchema = z.object({
  ...identitySchema,
  version: z.string().min(1),
  /** The mini app SDK contract it was built against; a newer one waits for a newer Localix. */
  apiVersion: z.number().int().positive().optional(),
  publisher: z.object({ name: z.string().min(1), verified: z.boolean().default(false) }),
  archive: archiveSchema,
  ...factFieldsSchema,
  ...pickFieldsSchema,
})
export type MiniAppCatalogApp = z.infer<typeof catalogAppSchema>
export type MiniAppCatalogFile = z.infer<typeof pinnedFileSchema> & { type?: string }

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
const collectionsSchema = optional(z.array(z.unknown())).transform((all) =>
  (all ?? []).flatMap((raw) => {
    const parsed = collectionSchema.safeParse(raw)
    return parsed.success ? [withoutEmpty(parsed.data)] : []
  }),
)
const editorialSchema = z.object({ collections: collectionsSchema })
export type MiniAppCatalogEditorial = z.infer<typeof editorialSchema>

export const withoutEmpty = <T extends Record<string, unknown>>(record: T): T =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T

export const catalogV1Schema = z.object({
  schema: z.literal(1),
  apps: z.array(z.unknown()),
  editorial: optional(editorialSchema),
})

/** Where a schema 2 entry is: built beside the catalog, or listed by another catalog. */
const sourceSchema = z.discriminatedUnion('source', [
  archiveSchema.extend({ source: z.literal('archive') }),
  z.object({ source: z.literal('github'), repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/) }),
  z.object({ source: z.literal('url'), url: z.string().min(1) }),
])

export const catalogV2AppSchema = z.object({
  ...identitySchema,
  version: z.string().min(1).optional(),
  apiVersion: z.number().int().positive().optional(),
  source: sourceSchema,
  ...factFieldsSchema,
})
export type MiniAppCatalogV2App = z.infer<typeof catalogV2AppSchema>

const picksSchema = z.object({
  featured: optional(z.array(z.string())),
  recommended: optional(z.array(z.string())),
  collections: collectionsSchema,
  suits: optional(z.record(z.string(), z.unknown())),
})

export const catalogV2Schema = z.object({
  schema: z.literal(2),
  name: z.string().min(1),
  owner: z.object({ name: z.string().min(1) }),
  metadata: optional(z.object({ localix: optional(picksSchema) })),
  apps: z.array(z.unknown()),
})
export type MiniAppCatalogV2Picks = z.infer<typeof picksSchema>

/** The picks of a schema 2 catalog, as schema 1 states them on each app. */
export function picksFor(name: string, picks: MiniAppCatalogV2Picks | undefined) {
  const suits = sourceSuitsSchema.parse(picks?.suits?.[name])
  return withoutEmpty({
    featured: picks?.featured?.includes(name) || undefined,
    recommended: picks?.recommended?.includes(name) || undefined,
    suits,
  })
}
