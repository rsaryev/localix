import { z } from 'zod'

import { STORE_CATEGORIES } from './categories'
import { configValueSchema } from './config'
import {
  collectionSchema,
  jobSchema,
  listingRefSchema,
  listingSchema,
  packageKindSchema,
  scopeSchema,
  sourceViewSchema,
  trustSchema,
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

/** A page of listings, and the most one request may ask for. */
export const LISTINGS_PAGE = 40
export const LISTINGS_PAGE_MAX = 500

export const listingsQuerySchema = z.object({
  shelf: z
    .string()
    .refine((value) => parseShelf(value) !== null, 'No such shelf')
    .optional(),
  q: z.string().max(200).optional(),
  scope: scopeSchema.optional(),
  installed: z.enum(['true', 'false']).optional(),
  category: z.enum(STORE_CATEGORIES).optional(),
  /** A source's id. */
  source: z.string().min(1).max(2048).optional(),
  trust: trustSchema.optional(),
  /** The open project: what it is written in lifts what suits it. */
  projectId: z.string().min(1).max(256).optional(),
  /** Where the previous page ended (`nextCursor`); absent for the first page. */
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(LISTINGS_PAGE_MAX).default(LISTINGS_PAGE),
})
export type ListingsQuery = z.infer<typeof listingsQuerySchema>

export const listingsResponseSchema = z.object({
  listings: z.array(listingSchema),
  facets: storeFacetsSchema,
  /** Sources that could not be read this time, each said in a sentence. */
  problems: z.array(z.string()),
  /** Where the next page starts; absent on the last page. */
  nextCursor: z.string().optional(),
  /**
   * How a search was answered: by words and meaning, or by words only while the meaning model is
   * not ready (`reason`). Absent when nothing was searched.
   */
  strategy: z
    .object({ mode: z.enum(['lexical', 'hybrid']), reason: z.string().optional() })
    .optional(),
})
export type ListingsResponse = z.infer<typeof listingsResponseSchema>

export const listingParamsSchema = z.object({ kind: packageKindSchema, id: z.string().min(1) })

/** The project a `project` scope means; the open one. */
const projectIdSchema = z.string().min(1).max(256).optional()

export const planRequestSchema = z.object({
  scope: scopeSchema.default('user'),
  projectId: projectIdSchema,
})

export const installRequestSchema = z.object({
  scope: scopeSchema.default('user'),
  projectId: projectIdSchema,
  /** The person saw the plan and said yes to what it warned about. */
  consent: z.object({ plan: z.boolean() }).default({ plan: false }),
})

export const scopeRequestSchema = z.object({
  scope: scopeSchema.default('user'),
  projectId: projectIdSchema,
})

export const enableRequestSchema = z.object({
  scope: scopeSchema.default('user'),
  projectId: projectIdSchema,
  enabled: z.boolean(),
})

/** `GET /:kind/:id/config`: whose settings, in which scope. */
export const configQuerySchema = z.object({
  scope: scopeSchema.default('user'),
  projectId: projectIdSchema,
})

/** `POST /:kind/:id/config`: the keys to save for one install's settings. */
export const configRequestSchema = z.object({
  scope: scopeSchema.default('user'),
  projectId: projectIdSchema,
  values: z.record(z.string(), configValueSchema),
})

/** `POST /:kind/:id/action`: one of the install's actions, by id. */
export const actionRequestSchema = z.object({
  scope: scopeSchema.default('user'),
  projectId: projectIdSchema,
  action: z.string().min(1).max(64),
})

/** `GET /create`: the kinds whose provider can make a new item. */
export const creatableResponseSchema = z.object({ kinds: z.array(packageKindSchema) })

export const createParamsSchema = z.object({ kind: packageKindSchema })

/** `POST /create/:kind`: make one from its form. */
export const createRequestSchema = z.object({
  scope: scopeSchema.default('user'),
  projectId: projectIdSchema,
  values: z.record(z.string(), configValueSchema),
})

export const sourceInputSchema = z.object({
  kind: packageKindSchema,
  input: z.string().min(1).max(2048),
})

export const sourceRemoveSchema = z.object({ kind: packageKindSchema, id: z.string().min(1) })

/** One source, by kind and id: read again (`/sources/refresh`). */
export const sourceRefSchema = sourceRemoveSchema

export const sourceAutoUpdateSchema = sourceRemoveSchema.extend({ autoUpdate: z.boolean() })

/** `GET /sources`: every source, and the kinds a source can be added for. */
export const sourcesResponseSchema = z.object({
  sources: z.array(sourceViewSchema),
  addable: z.array(packageKindSchema),
})
export type SourcesResponse = z.infer<typeof sourcesResponseSchema>

/** `GET /:kind/:id`: whose project's install the page shows beside the person's. */
export const detailQuerySchema = z.object({ projectId: z.string().min(1).max(256).optional() })

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

/**
 * `GET /rpc/store/discover`: what Discover shows. The editorial collections come from editorial
 * sources; the rows the Store computes (Start here, For this project, New & updated, one
 * per kind). Every listing an item names is in `listings`, so the page needs no other read.
 */
export const discoverQuerySchema = z.object({
  projectId: z.string().min(1).max(256).optional(),
})

export const discoverResponseSchema = z.object({
  updates: z.object({ count: z.number().int().nonnegative() }),
  rows: z.array(collectionSchema),
  categories: z.array(
    z.object({ id: z.string(), label: z.string(), count: z.number().int().nonnegative() }),
  ),
  listings: z.array(listingSchema),
})
export type DiscoverResponse = z.infer<typeof discoverResponseSchema>
