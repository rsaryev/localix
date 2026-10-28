import { z } from 'zod'

import { STORE_CATEGORIES } from './categories'
import { configValueSchema, itemActionSchema } from './config'
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

/**
 * A source of one package kind that could not be read this time, said in a sentence. The listings
 * it would have given are missing only from the shelves that list that kind.
 */
export const storeProblemSchema = z.object({ kind: packageKindSchema, message: z.string() })
export type StoreProblem = z.infer<typeof storeProblemSchema>

export const listingsResponseSchema = z.object({
  listings: z.array(listingSchema),
  facets: storeFacetsSchema,
  /** The unread sources whose kind this page lists; none on a page across every kind. */
  problems: z.array(storeProblemSchema),
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

/** Which install a call is about: the person's, or the open project's. */
export const scopedSchema = z.object({
  scope: scopeSchema.default('user'),
  projectId: projectIdSchema,
})

/** A form's or one install's settings to save, by key. */
export const scopedValuesSchema = scopedSchema.extend({
  values: z.record(z.string(), configValueSchema),
})

export const installRequestSchema = scopedSchema.extend({
  /** The person saw the plan and said yes to what it warned about. */
  consent: z.object({ plan: z.boolean() }).default({ plan: false }),
})

export const enableRequestSchema = scopedSchema.extend({ enabled: z.boolean() })

/** `POST /:kind/:id/action`: one of the install's actions, by id. */
export const actionRequestSchema = scopedSchema.extend({ action: z.string().min(1).max(64) })

/** `GET /create`: the kinds whose provider can make a new item. */
export const creatableResponseSchema = z.object({ kinds: z.array(packageKindSchema) })

/** `GET /shelf-actions`: what each kind's provider can do to a shelf (`scope` as in the query). */
export const shelfActionsResponseSchema = z.object({
  actions: z.array(itemActionSchema.extend({ kind: packageKindSchema })),
})
export type ShelfActionsResponse = z.infer<typeof shelfActionsResponseSchema>

/** `POST /shelf/:kind/run`: the action, and the ids of the items the person confirmed. */
export const shelfRunRequestSchema = actionRequestSchema.extend({
  ids: z.array(z.string().min(1)).max(LISTINGS_PAGE_MAX),
})

export const createParamsSchema = z.object({ kind: packageKindSchema })

export const sourceInputSchema = z.object({
  kind: packageKindSchema,
  input: z.string().min(1).max(2048),
})

/** One source, by kind and id: read again or removed. */
export const sourceRefSchema = z.object({ kind: packageKindSchema, id: z.string().min(1) })

export const sourceAutoUpdateSchema = sourceRefSchema.extend({ autoUpdate: z.boolean() })

/** `GET /sources`: every source, and the kinds a source can be added for. */
export const sourcesResponseSchema = z.object({
  sources: z.array(sourceViewSchema),
  addable: z.array(packageKindSchema),
})
export type SourcesResponse = z.infer<typeof sourcesResponseSchema>

/** `GET /:kind/:id`: whose project's install the page shows beside the person's. */
/** The open project, for what a page or Discover shows on top of the person's. */
export const projectQuerySchema = z.object({ projectId: projectIdSchema })

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
export const discoverResponseSchema = z.object({
  updates: z.object({ count: z.number().int().nonnegative() }),
  rows: z.array(collectionSchema),
  categories: z.array(
    z.object({ id: z.string(), label: z.string(), count: z.number().int().nonnegative() }),
  ),
  listings: z.array(listingSchema),
})
export type DiscoverResponse = z.infer<typeof discoverResponseSchema>

/**
 * What the person is working with, as every completion request carries it: the open tabs and
 * linked chips, each a binding target. The API resolves them through Context Fabric; the Store
 * never reads them itself.
 */
export const workingReferenceSchema = z.object({
  kind: z.string().min(1).max(64),
  token: z.string().max(2_048),
  label: z.string().max(512),
  uri: z.string().max(2_048).optional(),
  attributes: z
    .record(z.string(), z.union([z.string().max(2_048), z.number(), z.boolean()]))
    .optional(),
  origin: z.enum(['linked', 'ambient']).optional(),
})
export type WorkingReference = z.infer<typeof workingReferenceSchema>

/** `POST /rpc/store/recommendations/working-set`: the working set the recommendations are for. */
export const recommendRequestSchema = z.object({
  projectId: projectIdSchema,
  sessionId: z.string().min(1).max(256).optional(),
  references: z.array(workingReferenceSchema).max(32),
})
export type RecommendRequest = z.infer<typeof recommendRequestSchema>

/**
 * What suits the working set, best first, none installed, never empty while anything is left to
 * install. Nothing is `matched` while the meaning model is not ready (`strategy.mode` is
 * `lexical`): shared words are no reason to call a package suited.
 */
export const recommendResponseSchema = z.object({
  listings: z.array(listingSchema),
  /**
   * How many of the first listings meaning found for the working set; the rest are trusted
   * packages by score that fill the row. Only these are news worth telling the person about.
   */
  matched: z.number().int().nonnegative(),
  strategy: z.object({ mode: z.enum(['lexical', 'hybrid']), reason: z.string().optional() }),
})
export type RecommendResponse = z.infer<typeof recommendResponseSchema>

/** `GET /rpc/store/recommendations`: the project and chat a working set was reported for. */
export const recommendQuerySchema = z.object({
  projectId: projectIdSchema,
  sessionId: z.string().min(1).max(256).optional(),
})

/**
 * What the background worked out for that working set (`recommend-board.ts`). `pending` while a
 * newer working set is being worked out: the listings are then the previous answer, or the
 * first answer is on its way and the `store-recommendations` poke says when it lands.
 */
export const recommendReadSchema = recommendResponseSchema.extend({ pending: z.boolean() })
export type RecommendRead = z.infer<typeof recommendReadSchema>
