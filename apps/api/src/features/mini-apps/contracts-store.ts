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
  job: z
    .object({
      phase: z.enum(['queued', 'installing', 'done', 'failed']),
      error: z.string().optional(),
    })
    .optional(),
})
export type MiniAppStoreEntryRecord = z.infer<typeof miniAppStoreEntrySchema>

export const miniAppStoreResponseSchema = z.object({ entries: z.array(miniAppStoreEntrySchema) })

export const installMiniAppRequestSchema = z.object({ name: z.string().min(1) })
