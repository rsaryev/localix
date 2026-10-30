import { readCollections, readCuration, type Curation, type Editorial } from '@localixai/store'
import { z } from 'zod'

import { miniAppFileAssociationSchema } from '../manifest/index'
import {
  MINI_APP_NAME_RE,
  MINI_APP_SCREENSHOTS_MAX,
  MINI_APP_TAG_RE,
  MINI_APP_TAGS_MAX,
} from '../manifest/primitives'
import {
  ED25519_KEY_RE,
  GITHUB_REPO_RE,
  MARKETPLACE_NAME_RE,
  MARKETPLACE_SCHEMA,
  marketplaceAppId,
  SHA256_RE,
} from './constants'

/**
 * READING A RELEASED MARKETPLACE (`docs/extending/mini-app-marketplace.md`), the way Localix
 * does: leniently. A field Localix does not know is passed over; a field that does not read is
 * dropped alone, so a bad icon never hides its app; an app that does not read is left out while
 * the rest load. Only what makes the file a marketplace at all — its schema, name, owner and apps —
 * refuses it, and a newer schema asks for a newer Localix rather than a guess.
 * `validate.ts` is the strict side, for the people who write one.
 */

/** A file published beside the marketplace, pinned by its size and sha256. */
export interface PinnedFile {
  url: string
  bytes: number
  sha256: string
}
export type PinnedImage = PinnedFile & { type: string }

/** Where an app is: built beside the marketplace, or in another released marketplace. */
export type MarketplaceAppSource =
  | ({ source: 'archive' } & PinnedFile)
  | { source: 'github'; repo: string }
  | { source: 'url'; url: string }

export interface MarketplaceRevocation {
  reason: string
  /** The versions taken back; absent, every version. */
  versions?: string[]
}

/** One app as a released marketplace lists it. */
export interface MarketplaceApp {
  name: string
  /** Absent only for an app revoked as a whole. */
  source?: MarketplaceAppSource
  displayName?: string
  description?: string
  category?: string
  version?: string
  /** The mini app SDK contract it was built against; a newer one waits for a newer Localix. */
  apiVersion?: number
  tags?: string[]
  author?: string
  license?: string
  homepage?: string
  surfaces?: string[]
  commands?: string[]
  /** The kinds of file it opens, from its manifest's `fileAssociations` (`docx`, `request.json`). */
  opens?: string[]
  icon?: PinnedImage
  screenshots?: (PinnedImage & { caption?: string })[]
  readme?: PinnedFile
  /** The keeper's curation; Localix honours it only from a marketplace it trusts. */
  curation: Curation
  revoked?: MarketplaceRevocation
}

export interface BlockedArchive {
  sha256: string
  reason: string
}

export interface Marketplace {
  schema: typeof MARKETPLACE_SCHEMA
  name: string
  owner: { name: string; email?: string; url?: string }
  description?: string
  /** When the release was made (ISO 8601), inside the signed bytes: Localix refuses an older one. */
  published?: string
  /** The Ed25519 public keys (base64) that sign the next release. */
  signingKeys?: string[]
  apps: MarketplaceApp[]
  /** Discover's rows; honoured only from a marketplace Localix trusts. */
  collections: Editorial['collections']
  /** Archives blocked whatever marketplace they came from; honoured only from Localix's own. */
  blockedArchives: BlockedArchive[]
}

export type MarketplaceRead =
  | { kind: 'marketplace'; marketplace: Marketplace }
  /** A newer format than this reader knows: update Localix. */
  | { kind: 'newer'; schema: number }
  | { kind: 'invalid'; problem: string }

/** A field read alone: what does not read is undefined. */
const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined)

const pinnedFileSchema = z.object({
  url: z.string().min(1).max(2048),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(SHA256_RE),
})
const pinnedImageSchema = pinnedFileSchema.extend({ type: z.string().min(1).max(100) })

/** A list read item by item: what does not read is dropped, the rest kept. */
const each = <T extends z.ZodType>(item: T, max: number) =>
  lenient(
    z
      .array(z.unknown())
      .transform((all) => all.flatMap((raw) => item.safeParse(raw).data ?? []).slice(0, max)),
  )

/** An Ed25519 public key: 32 bytes, base64. */
const keySchema = z.string().regex(ED25519_KEY_RE)

const sourceSchema = z.discriminatedUnion('source', [
  pinnedFileSchema.extend({ source: z.literal('archive') }),
  z.object({ source: z.literal('github'), repo: z.string().regex(GITHUB_REPO_RE) }),
  // Resolved against the marketplace's address by its reader, which allows https only (or a file
  // beside a marketplace read from a folder).
  z.object({ source: z.literal('url'), url: z.string().min(1).max(2048) }),
])

const revocationSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  versions: z.array(z.string().min(1).max(64)).min(1).max(100).optional(),
})

const appSchema = z.object({
  name: z.string().max(64).regex(MINI_APP_NAME_RE),
  source: lenient(sourceSchema),
  displayName: lenient(z.string().min(1).max(80)),
  description: lenient(z.string().min(1).max(2000)),
  category: lenient(z.string().min(1).max(64)),
  version: lenient(z.string().min(1).max(64)),
  apiVersion: lenient(z.number().int().positive()),
  tags: each(z.string().regex(MINI_APP_TAG_RE).max(32), MINI_APP_TAGS_MAX),
  author: lenient(
    z
      .union([z.string(), z.object({ name: z.string() }).transform(({ name }) => name)])
      .pipe(z.string().min(1).max(120)),
  ),
  license: lenient(z.string().min(1).max(64)),
  homepage: lenient(z.string().url().startsWith('https://')),
  surfaces: each(z.string().min(1).max(32), 16),
  commands: each(z.string().min(1).max(64), 64),
  fileAssociations: lenient(z.array(z.unknown())),
  icon: lenient(pinnedImageSchema),
  screenshots: each(
    pinnedImageSchema.extend({ caption: z.string().max(140).optional() }),
    MINI_APP_SCREENSHOTS_MAX,
  ),
  readme: lenient(pinnedFileSchema),
  revoked: lenient(revocationSchema),
})

/** The most kinds of file one app may say it opens. */
const OPENS_MAX = 64

/** The kinds a manifest's `fileAssociations` open, leaving out one it asks not to be offered for. */
function opensOf(declared: unknown[] | undefined): string[] {
  const kinds = (declared ?? []).flatMap((entry) => {
    const association = miniAppFileAssociationSchema.safeParse(entry).data
    return association && association.rank !== 'None' ? association.ext : []
  })
  return [...new Set(kinds)].slice(0, OPENS_MAX)
}

const withoutEmpty = <T extends Record<string, unknown>>(record: T): T =>
  Object.fromEntries(
    Object.entries(record).filter(
      ([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0),
    ),
  ) as T

function readApp(raw: unknown): MarketplaceApp | null {
  const parsed = appSchema.safeParse(raw)
  if (!parsed.success) return null
  const { fileAssociations, revoked, source, ...facts } = parsed.data
  // An app is installable from its source; only one taken back whole may have none.
  if (!source && !(revoked && !revoked.versions)) return null
  const opens = opensOf(fileAssociations)
  return withoutEmpty({
    ...facts,
    source,
    opens,
    curation: readCuration(raw),
    revoked,
  }) as MarketplaceApp
}

const ownerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: lenient(z.string().email()),
  url: lenient(z.string().url().startsWith('https://')),
})

const shellSchema = z.object({
  name: z.string().regex(MARKETPLACE_NAME_RE),
  owner: ownerSchema,
  metadata: lenient(z.object({ description: lenient(z.string().min(1).max(2000)) })),
  published: lenient(z.iso.datetime({ offset: true })),
  signingKeys: each(keySchema, 8),
  apps: z.array(z.unknown()),
  collections: lenient(z.unknown()),
  blockedArchives: each(
    z.object({ sha256: z.string().regex(SHA256_RE), reason: z.string().trim().min(1).max(500) }),
    10_000,
  ),
})

/** A released marketplace's JSON, read as Localix reads it. */
export function readMarketplace(raw: unknown): MarketplaceRead {
  const schema = (raw as { schema?: unknown } | null)?.schema
  if (typeof schema === 'number' && Number.isInteger(schema) && schema > MARKETPLACE_SCHEMA)
    return { kind: 'newer', schema }
  if (schema !== MARKETPLACE_SCHEMA)
    return { kind: 'invalid', problem: `not a schema ${MARKETPLACE_SCHEMA} mini app marketplace` }
  const parsed = shellSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    return { kind: 'invalid', problem: `${issue.path.join('.') || 'the file'}: ${issue.message}` }
  }
  const { name, owner, metadata, published, signingKeys, apps, collections, blockedArchives } =
    parsed.data
  return {
    kind: 'marketplace',
    marketplace: {
      schema: MARKETPLACE_SCHEMA,
      name,
      owner: withoutEmpty(owner),
      ...withoutEmpty({ description: metadata?.description, published, signingKeys }),
      apps: apps.flatMap((app) => readApp(app) ?? []),
      collections: readCollections(collections, (app) => ({
        kind: 'mini-app',
        id: marketplaceAppId(app, name),
      })),
      blockedArchives: blockedArchives ?? [],
    },
  }
}
