import { z } from 'zod'

import { listingRefSchema } from './contract'

/** What Discover shows together (`docs/internals/store.md`, "Discover as built"). */

/** How a Discover collection is drawn: a scrolling row, or a grid. */
export const collectionStyleSchema = z.enum(['row', 'grid'])
export type CollectionStyle = z.infer<typeof collectionStyleSchema>

/**
 * A group of listings Discover shows together: an editorial source's collection or one the
 * Store computes (Start here, For this project, New & updated, a kind).
 */
export const collectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  style: collectionStyleSchema,
  items: z.array(listingRefSchema),
  /** The source that picked it; absent for a row the Store computed. */
  source: z.string().optional(),
})
export type Collection = z.infer<typeof collectionSchema>

/**
 * What an editorial source picks for Discover (`docs/internals/store.md`): collections
 * that may mix kinds. Only a source whose default entry is editorial hands any over, and the
 * Store never shows a community listing in them.
 */
export const editorialSchema = z.object({
  /** The source's id, as its listings name it. */
  source: z.string(),
  collections: z.array(collectionSchema.omit({ source: true })),
})
export type Editorial = z.infer<typeof editorialSchema>
