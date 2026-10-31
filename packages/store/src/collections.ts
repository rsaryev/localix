import { z } from 'zod'

import { listingRefSchema, packageKindSchema, type ListingRef } from './contract'
import { isRecord } from './curation'

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

const text = (raw: unknown, max: number) =>
  typeof raw === 'string' && raw.length > 0 && raw.length <= max ? raw : undefined
/** The most items one row holds. */
const ITEMS_MAX = 48

/** An item: `<kind>:<id>` names any package; anything else is the marketplace's own, by name. */
function itemRef(item: unknown, own: (name: string) => ListingRef): ListingRef | null {
  if (typeof item !== 'string' || !item) return null
  const at = item.indexOf(':')
  if (at < 0) return own(item)
  const kind = packageKindSchema.safeParse(item.slice(0, at))
  return kind.success && at < item.length - 1 ? { kind: kind.data, id: item.slice(at + 1) } : null
}

/**
 * A marketplace's `collections`, read leniently (`docs/extending/mini-app-marketplace.md`,
 * "Curation"): a row without an id or title is dropped, and so is an item that names nothing, each
 * alone. `own` says what a bare name is in this marketplace.
 */
export function readCollections(
  raw: unknown,
  own: (name: string) => ListingRef,
): Editorial['collections'] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((row) => {
    if (!isRecord(row)) return []
    const id = text(row.id, 64)
    const title = text(row.title, 120)
    if (!id || !title) return []
    const subtitle = text(row.subtitle, 240)
    const items = Array.isArray(row.items) ? row.items : []
    return [
      {
        id,
        title,
        ...(subtitle ? { subtitle } : {}),
        style: row.style === 'grid' ? ('grid' as const) : ('row' as const),
        items: items.flatMap((item) => itemRef(item, own) ?? []).slice(0, ITEMS_MAX),
      },
    ]
  })
}
