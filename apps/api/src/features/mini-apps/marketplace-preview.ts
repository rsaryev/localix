import type { PinnedImage } from '@localixai/mini-app-sdk/marketplace'

import { InvalidRequestError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import { readMarketplaceFeed, type MarketplaceFeed } from './marketplace-feed'
import { marketplaceUrlOf, type MiniAppMarketplaces } from './marketplaces'
import type { StoreMediaFile } from './store-media'

/** How many apps' icons a preview shows. */
const PREVIEW_ICONS = 4

/** What a marketplace would add, read before the person says yes (`previewSource`). */
export interface MarketplacePreview {
  /** The address as it would be kept. */
  url: string
  /** What it calls itself: the second half of every app's identity. */
  name: string
  /** Who keeps it. */
  publishers: string[]
  /** The apps it offers, its links among them; one taken back whole is not counted. */
  apps: number
  /** The first apps that have an icon, each as a `data:` URL an `<img>` shows. */
  icons: { name: string; label: string; src: string }[]
  /** A marketplace someone adds is never verified: Localix vouches only for its own. */
  verified: false
  /** It is already in the list. */
  added: boolean
}

/**
 * Read a marketplace the person is about to add, so the dialog can say what it is called, who
 * keeps it and what is in it before anything is kept. One that does not read is refused with the
 * reason; nothing here writes.
 */
export async function previewMarketplace(
  raw: string,
  deps: {
    fetchImpl?: typeof fetch
    marketplaceImage: (file: PinnedImage) => Promise<StoreMediaFile | null>
    added: () => Promise<string[]>
  },
): Promise<MarketplacePreview> {
  const url = marketplaceUrlOf(raw)
  if (!url)
    throw new InvalidRequestError(
      'mini_app_marketplace_url',
      'A marketplace is an https:// address, a file:// path or a GitHub owner/name',
    )
  let feed: MarketplaceFeed
  try {
    feed = await readMarketplaceFeed(url, { fetchImpl: deps.fetchImpl })
  } catch (error) {
    throw new InvalidRequestError('mini_app_marketplace_unreadable', errorMessage(error))
  }
  const { name, owner, apps } = feed.marketplace
  const offered = apps.filter((app) => app.source && !(app.revoked && !app.revoked.versions))
  const icons = await Promise.all(
    offered
      .filter((app) => app.icon)
      .slice(0, PREVIEW_ICONS)
      .map(async (app) => {
        const image = await deps.marketplaceImage(app.icon!)
        if (!image) return []
        const src = `data:${image.type};base64,${Buffer.from(image.bytes).toString('base64')}`
        return [{ name: app.name, label: app.displayName ?? app.name, src }]
      }),
  )
  return {
    url,
    name,
    publishers: [owner.name],
    apps: offered.length,
    icons: icons.flat(),
    verified: false,
    added: (await deps.added()).includes(url),
  }
}

/** The marketplaces, with a look at one before it is added (its icons through the store's cache). */
export function withMarketplacePreview(
  marketplaces: MiniAppMarketplaces,
  store: { marketplaceImage: (file: PinnedImage) => Promise<StoreMediaFile | null> },
  fetchImpl?: typeof fetch,
) {
  return {
    ...marketplaces,
    preview: (raw: string) =>
      previewMarketplace(raw, {
        ...(fetchImpl ? { fetchImpl } : {}),
        marketplaceImage: store.marketplaceImage,
        added: async () => (await marketplaces.list()).map((marketplace) => marketplace.url),
      }),
  }
}
