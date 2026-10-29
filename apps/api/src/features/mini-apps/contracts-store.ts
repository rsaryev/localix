import { z } from 'zod'

const jobPhaseSchema = z.enum(['queued', 'downloading', 'installing', 'done', 'failed'])

/** One app a catalog offers, as the store shows it (`store.ts`). */
export const miniAppStoreEntrySchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string(),
  category: z.string().optional(),
  version: z.string().optional(),
  publisher: z.object({ name: z.string(), verified: z.boolean() }),
  /** The catalog it comes from, as `/catalogs` lists it. */
  source: z.string(),
  /** A host address (`/rpc/mini-apps/store/media/…`), never where the catalog keeps the file. */
  icon: z.string().optional(),
  tags: z.array(z.string()).optional(),
  featured: z.boolean().optional(),
  /** Localix installs it on its own on a new installation (`recommended.ts`). */
  recommended: z.boolean().optional(),
  /** What it adds: `workbench` is a screen of its own (the one a desktop app opens on). */
  surfaces: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
  installed: z.object({ version: z.string().optional() }).nullable(),
  update: z.boolean(),
  incompatible: z.boolean().optional(),
  job: z
    .object({
      phase: jobPhaseSchema,
      received: z.number().optional(),
      total: z.number().optional(),
      error: z.string().optional(),
    })
    .optional(),
})
export type MiniAppStoreEntryRecord = z.infer<typeof miniAppStoreEntrySchema>

export const miniAppStoreResponseSchema = z.object({
  entries: z.array(miniAppStoreEntrySchema),
  /** Catalogs that could not be read this time. */
  problems: z.array(z.string()),
})
export type MiniAppStoreResponse = z.infer<typeof miniAppStoreResponseSchema>

export const installMiniAppRequestSchema = z.object({
  name: z.string().min(1),
  /** The person said yes to a publisher Localix does not vouch for. */
  acceptUnverified: z.boolean().optional(),
})

/** A package the person built (`mini-app build`), handed over by the authoring plugin. */
export const installLocalMiniAppRequestSchema = z.object({
  /** The package folder, absolute. */
  dir: z.string().min(1),
  /** The source folder it was built from, recorded beside the installed copy. */
  source: z.string().min(1),
})

export const installLocalMiniAppResponseSchema = z.object({
  name: z.string(),
  version: z.string(),
  /** What Localix mentions about the app but does not refuse. */
  warnings: z.array(z.string()),
})

/** One catalog the store reads (`catalogs.ts`). */
export const miniAppCatalogSchema = z.object({ url: z.string(), builtIn: z.boolean() })
export type MiniAppCatalogEntryRecord = z.infer<typeof miniAppCatalogSchema>

export const miniAppCatalogsResponseSchema = z.object({ catalogs: z.array(miniAppCatalogSchema) })

export const miniAppCatalogRequestSchema = z.object({ url: z.string().min(1).max(2048) })

/** One app's store page (`GET /store/:name`). */
export const miniAppStorePageSchema = z.object({
  entry: miniAppStoreEntrySchema,
  readme: z.string().nullable(),
  screenshots: z.array(z.object({ url: z.string(), caption: z.string().optional() })),
  details: z.object({
    version: z.string().optional(),
    apiVersion: z.number().optional(),
    size: z.number().optional(),
    license: z.string().optional(),
    author: z.string().optional(),
    homepage: z.string().optional(),
    surfaces: z.array(z.string()).optional(),
    commands: z.number().optional(),
  }),
})
export type MiniAppStorePageRecord = z.infer<typeof miniAppStorePageSchema>

export const miniAppStoreMediaParamsSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['icon', 'screenshot']),
  index: z.coerce.number().int().min(0).max(9).optional(),
})

/** What a catalog would add, read before it is added (`POST /catalogs/preview`). */
export const miniAppCatalogPreviewSchema = z.object({
  url: z.string(),
  publishers: z.array(z.string()),
  apps: z.number(),
  icons: z.array(z.object({ name: z.string(), label: z.string(), src: z.string() })),
  verified: z.literal(false),
  added: z.boolean(),
})
export type MiniAppCatalogPreviewRecord = z.infer<typeof miniAppCatalogPreviewSchema>
