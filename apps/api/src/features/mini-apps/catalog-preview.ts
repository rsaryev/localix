import { InvalidRequestError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import { readMiniAppCatalog, type MiniAppCatalogApp } from './catalog-feed'
import { normalizeCatalogUrl, type MiniAppCatalogs } from './catalogs'
import type { StoreMediaFile } from './store-media'
import type { OfferFile } from './store-offers'

/** How many apps' icons a preview shows. */
const PREVIEW_ICONS = 4

/** What a catalog would add, read before the person says yes (`POST /catalogs/preview`). */
export interface MiniAppCatalogPreview {
  /** The address as it would be kept. */
  url: string
  publishers: string[]
  apps: number
  /** The first apps that have an icon, each as a `data:` URL an `<img>` shows. */
  icons: { name: string; label: string; src: string }[]
  /** A catalog someone adds is never verified: Localix vouches only for its own. */
  verified: false
  /** It is already in the list. */
  added: boolean
}

/**
 * Read a catalog the person is about to add, so the dialog can say who publishes it and what is
 * in it before anything is kept. A catalog that does not read is refused with the reason; nothing
 * here writes.
 */
export async function previewMiniAppCatalog(
  raw: string,
  deps: {
    fetchImpl?: typeof fetch
    catalogImage: (file: Extract<OfferFile, { from: 'catalog' }>) => Promise<StoreMediaFile | null>
    added: () => Promise<string[]>
  },
): Promise<MiniAppCatalogPreview> {
  const url = normalizeCatalogUrl(raw)
  if (!url)
    throw new InvalidRequestError(
      'mini_app_catalog_url',
      'A catalog is an HTTPS address or a file:// path to its mini-app-catalog.json',
    )
  let apps: MiniAppCatalogApp[]
  try {
    apps = await readMiniAppCatalog(url, { fetchImpl: deps.fetchImpl })
  } catch (error) {
    throw new InvalidRequestError('mini_app_catalog_unreadable', errorMessage(error))
  }
  const icons = await Promise.all(
    apps
      .filter((app) => app.icon)
      .slice(0, PREVIEW_ICONS)
      .map(async (app) => {
        const image = await deps.catalogImage({ from: 'catalog', ...app.icon! })
        if (!image) return []
        const src = `data:${image.type};base64,${Buffer.from(image.bytes).toString('base64')}`
        return [{ name: app.name, label: app.displayName ?? app.name, src }]
      }),
  )
  return {
    url,
    publishers: [...new Set(apps.map((app) => app.publisher.name))],
    apps: apps.length,
    icons: icons.flat(),
    verified: false,
    added: (await deps.added()).includes(url),
  }
}

/** The catalogs, with a look at one before it is added (its icons through the store's cache). */
export function withCatalogPreview(
  catalogs: MiniAppCatalogs,
  store: { catalogImage: Parameters<typeof previewMiniAppCatalog>[1]['catalogImage'] },
) {
  return {
    ...catalogs,
    preview: (url: string) =>
      previewMiniAppCatalog(url, {
        catalogImage: store.catalogImage,
        added: async () => (await catalogs.list()).map((catalog) => catalog.url),
      }),
  }
}
