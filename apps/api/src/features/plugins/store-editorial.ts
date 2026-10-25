import { z } from 'zod'
import { packageKindSchema, type Editorial, type ListingRef } from '@localixai/store'

import type { MarketView } from './store-listing'

/**
 * A MARKETPLACE'S PICKS FOR THE STORE: Localix's own optional key `metadata.localix` in
 * `.claude-plugin/marketplace.json`, which Claude Code ignores (it validates the known metadata
 * keys only). It names the entries Discover recommends and features, and collections whose
 * items are entry names, or `<kind>:<id>` for another kind. Read for an editorial marketplace
 * only (`@localixai/store`'s default sources); a community one picks nothing.
 */
const names = z
  .array(z.unknown())
  .transform((all) => all.filter((name): name is string => typeof name === 'string'))
  .catch([])
const optionalText = z.string().min(1).max(240).optional().catch(undefined)
const picksSchema = z.object({
  featured: names.optional(),
  recommended: names.optional(),
  collections: z
    .array(z.unknown())
    .transform((all) =>
      all.flatMap((raw) => {
        const parsed = z
          .object({
            id: z.string().min(1).max(64),
            title: z.string().min(1).max(120),
            subtitle: optionalText,
            style: z.enum(['row', 'grid']).catch('row'),
            items: names,
          })
          .safeParse(raw)
        return parsed.success ? [parsed.data] : []
      }),
    )
    .optional()
    .catch(undefined),
})

const read = new WeakMap<MarketView, ReturnType<typeof readPicks>>()

/** The picks of an editorial marketplace; empty for any other. Read once per view. */
export function marketPicks(view: MarketView): ReturnType<typeof readPicks> {
  const held = read.get(view)
  if (held) return held
  const picks = readPicks(view)
  read.set(view, picks)
  return picks
}

function readPicks(view: MarketView) {
  const raw = view.editorial ? view.market.metadata?.localix : undefined
  const parsed = picksSchema.safeParse(raw ?? {})
  const picks = parsed.success ? parsed.data : {}
  return {
    featured: new Set(picks.featured ?? []),
    recommended: new Set(picks.recommended ?? []),
    collections: picks.collections ?? [],
  }
}

/** An item: one of this marketplace's entries by name, or `<kind>:<id>`. */
function refOf(view: MarketView, item: string): ListingRef | null {
  const at = item.indexOf(':')
  if (at < 0) return { kind: 'plugin', id: `${item}@${view.name}` }
  const kind = packageKindSchema.safeParse(item.slice(0, at))
  return kind.success && at < item.length - 1 ? { kind: kind.data, id: item.slice(at + 1) } : null
}

export function marketEditorial(view: MarketView): Editorial | null {
  const picks = marketPicks(view)
  if (picks.collections.length === 0) return null
  return {
    source: view.name,
    collections: picks.collections.map((collection) => ({
      id: collection.id,
      title: collection.title,
      ...(collection.subtitle ? { subtitle: collection.subtitle } : {}),
      style: collection.style,
      items: collection.items.flatMap((item) => refOf(view, item) ?? []),
    })),
  }
}
