import { z } from 'zod'

const jobPhaseSchema = z.enum(['queued', 'downloading', 'installing', 'done', 'failed'])

/** One app a marketplace offers, as the store shows it (`store.ts`). */
export const miniAppStoreEntrySchema = z.object({
  /** Its identity, `<name>@<marketplace>`. */
  id: z.string(),
  name: z.string(),
  marketplace: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string(),
  category: z.string().optional(),
  version: z.string().optional(),
  publisher: z.object({ name: z.string(), verified: z.boolean() }),
  /** The marketplace it comes from, by address. */
  source: z.string(),
  signature: z.enum(['signed', 'unsigned', 'mismatch']).optional(),
  /** A host address (`/rpc/mini-apps/store/media/…`), never where the marketplace keeps it. */
  icon: z.string().optional(),
  tags: z.array(z.string()).optional(),
  featured: z.boolean().optional(),
  /** Localix installs it on its own on a new installation (`recommended.ts`). */
  installByDefault: z.boolean().optional(),
  /** What it adds: `workbench` is a screen of its own (the one a desktop app opens on). */
  surfaces: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
  installed: z.object({ version: z.string().optional() }).nullable(),
  update: z.boolean(),
  incompatible: z.boolean().optional(),
  /** Another app here holds its name, and what to do about it (`store.ts`, `nameConflict`). */
  nameTaken: z.string().optional(),
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
  /** Marketplaces that could not be read this time. */
  problems: z.array(z.string()),
})
export type MiniAppStoreResponse = z.infer<typeof miniAppStoreResponseSchema>

export const installMiniAppRequestSchema = z.object({
  /** An identity, `<name>@<marketplace>`, or a name alone (`store.ts`). */
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

/** One app's store page (`GET /store/:id`). */
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
  id: z.string().min(1),
  kind: z.enum(['icon', 'screenshot']),
  index: z.coerce.number().int().min(0).max(9).optional(),
})
