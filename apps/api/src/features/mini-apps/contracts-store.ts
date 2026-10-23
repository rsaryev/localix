import { z } from 'zod'

/** One app a catalog offers, as the store shows it (`store.ts`). */
export const miniAppStoreEntrySchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string(),
  category: z.string().optional(),
  version: z.string().optional(),
  publisher: z.object({ name: z.string(), verified: z.boolean() }),
  installed: z.object({ version: z.string().optional() }).nullable(),
  update: z.boolean(),
  incompatible: z.boolean().optional(),
  job: z
    .object({
      phase: z.enum(['queued', 'downloading', 'installing', 'done', 'failed']),
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
