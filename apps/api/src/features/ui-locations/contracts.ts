import { z } from 'zod'

export const uiLocationCatalogPublishSchema = z
  .object({
    publisherId: z.string().regex(/^[a-zA-Z0-9._~-]{1,128}$/),
    projectId: z.string().min(1).max(256).nullable(),
    catalog: z.unknown(),
  })
  .strict()
