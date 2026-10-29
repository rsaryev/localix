import { z } from 'zod'

import { listingRefSchema, listingSchema } from './contract'
import { projectIdSchema } from './routes'

/**
 * The bodies of `/rpc/store/recommendations` (`docs/internals/store.md`, "Recommendations"),
 * shared by the routes that answer them and the client that reads them.
 */

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
 * Why a package is recommended: the interest that found it (`docs/internals/store.md`,
 * "Recommendations"). `linked` a chip the person linked, `open` a tab beside them, `context` what
 * a provider added for the work, `installed` packages they chose, `project` what the open project
 * is written in; `trusted` a trusted package by score that fills the row. `label` names it: the
 * file, the installed packages, the project's languages.
 */
export const recommendReasonSchema = z.object({
  source: z.enum(['linked', 'open', 'context', 'installed', 'project', 'trusted']),
  label: z.string().max(200).optional(),
})
export type RecommendReason = z.infer<typeof recommendReasonSchema>

/**
 * What suits the working set, best first, none installed and none the person turned down, never
 * empty while anything is left to install. Nothing is `matched` while the meaning model is not
 * ready (`strategy.mode` is `lexical`): shared words are no reason to call a package suited.
 */
export const recommendResponseSchema = z.object({
  listings: z.array(listingSchema),
  /**
   * How many of the first listings meaning found for the working set; the rest are trusted
   * packages by score that fill the row. Only these are news worth telling the person about.
   */
  matched: z.number().int().nonnegative(),
  strategy: z.object({ mode: z.enum(['lexical', 'hybrid']), reason: z.string().optional() }),
  /** Why each listing is here, by `kind:id`. */
  reasons: z.record(z.string(), recommendReasonSchema),
})
export type RecommendResponse = z.infer<typeof recommendResponseSchema>

/**
 * `PUT /rpc/store/recommendations/dismissals`: the person is not interested in a package (or takes
 * that back). It is never recommended to them again; search and the shelves still list it.
 */
export const recommendDismissalSchema = z.object({
  ref: listingRefSchema,
  dismissed: z.boolean(),
})
export type RecommendDismissal = z.infer<typeof recommendDismissalSchema>

/**
 * `GET /rpc/store/recommendations/dismissals`: what is kept out of the person's recommendations,
 * newest first, and why — they were not interested, or they removed it through the Store.
 */
export const recommendDismissalsSchema = z.object({
  dismissed: z.array(
    z.object({ listing: listingSchema, reason: z.enum(['not-interested', 'removed']) }),
  ),
})
export type RecommendDismissals = z.infer<typeof recommendDismissalsSchema>

/**
 * `POST /rpc/store/recommendations/events` (`202`): recommendations a surface showed, or the one
 * the person opened from it, each with its place and what found it. The Store reads them to rest
 * a package shown day after day and never opened, and to tell which interests work.
 */
export const recommendEventSchema = z.object({
  ref: listingRefSchema,
  event: z.enum(['shown', 'opened']),
  slot: z.number().int().min(0).max(500),
  source: recommendReasonSchema.shape.source.optional(),
})
export type RecommendEvent = z.infer<typeof recommendEventSchema>
export const recommendEventsSchema = z.object({ events: z.array(recommendEventSchema).max(50) })

/** `GET /rpc/store/recommendations/stats`: per kind of interest, the last 90 days' counts. */
export const recommendStatsSchema = z.object({
  sources: z.record(
    z.string(),
    z.object({ shown: z.number(), opened: z.number(), installed: z.number() }),
  ),
})

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
