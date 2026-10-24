import { z } from 'zod'

import {
  jobSchema,
  listingRefSchema,
  listingSchema,
  packageKindSchema,
  scopeSchema,
} from './contract'
import { parseShelf } from './shelves'

/**
 * The bodies of `/rpc/store` (`docs/internals/store.md`, "Routes"), shared by the routes that
 * answer them and the client that reads them.
 */

/** Counts over every listing, so the shelf navigation stays put while a shelf is filtered. */
export const storeFacetsSchema = z.object({
  shelves: z.record(z.string(), z.number()),
  kind: z.record(z.string(), z.number()),
  component: z.record(z.string(), z.number()),
  category: z.record(z.string(), z.number()),
  source: z.record(z.string(), z.number()),
  installed: z.number(),
  updates: z.number(),
})
export type StoreFacets = z.infer<typeof storeFacetsSchema>

export const listingsQuerySchema = z.object({
  shelf: z
    .string()
    .refine((value) => parseShelf(value) !== null, 'No such shelf')
    .optional(),
  q: z.string().max(200).optional(),
  scope: scopeSchema.optional(),
  installed: z.enum(['true', 'false']).optional(),
})
export type ListingsQuery = z.infer<typeof listingsQuerySchema>

export const listingsResponseSchema = z.object({
  listings: z.array(listingSchema),
  facets: storeFacetsSchema,
  /** Sources that could not be read this time, each said in a sentence. */
  problems: z.array(z.string()),
})
export type ListingsResponse = z.infer<typeof listingsResponseSchema>

export const listingParamsSchema = z.object({ kind: packageKindSchema, id: z.string().min(1) })

export const planRequestSchema = z.object({ scope: scopeSchema.default('user') })

export const installRequestSchema = z.object({
  scope: scopeSchema.default('user'),
  /** The person saw the plan and said yes to what it warned about. */
  consent: z.object({ plan: z.boolean() }).default({ plan: false }),
})

export const scopeRequestSchema = z.object({ scope: scopeSchema.default('user') })

export const enableRequestSchema = z.object({
  scope: scopeSchema.default('user'),
  enabled: z.boolean(),
})

export const sourceInputSchema = z.object({
  kind: packageKindSchema,
  input: z.string().min(1).max(2048),
})

export const sourceRemoveSchema = z.object({ kind: packageKindSchema, id: z.string().min(1) })

/** Jobs in flight and the updates offered, across kinds: the Event Center and the update strip. */
export const storeActivitySchema = z.object({
  jobs: z.array(
    jobSchema.extend({
      ref: listingRefSchema,
      displayName: z.string(),
      icon: z.string().optional(),
      version: z.string().optional(),
    }),
  ),
  updates: z.array(
    z.object({
      ref: listingRefSchema,
      displayName: z.string(),
      icon: z.string().optional(),
      from: z.string().optional(),
      to: z.string(),
    }),
  ),
})
export type StoreActivity = z.infer<typeof storeActivitySchema>

export const updatesApplyResponseSchema = z.object({ queued: z.array(listingRefSchema) })
