import { storeMediaUrl, type StoreMediaReader } from './store-media'
import type { Offer } from './store-offers'

/** What an app's store page says beside its row (`GET /rpc/mini-apps/store/:name`). */
export interface MiniAppStoreDetails {
  version?: string
  apiVersion?: number
  /** The archive's bytes. */
  size?: number
  license?: string
  author?: string
  homepage?: string
  /** What it adds: `agent` (tools for the agent), `workbench` (a screen of its own). */
  surfaces?: string[]
  /** How many `/<app>:<command>` commands its manifest declares. */
  commands?: number
}

export interface MiniAppStorePage<TEntry> {
  entry: TEntry
  /** The README as Markdown, or null when the app has none (or it could not be read). */
  readme: string | null
  /** Host addresses, at the resolution the app published. */
  screenshots: { url: string; caption?: string }[]
  details: MiniAppStoreDetails
}

/** The store page of one offer, around the row the list already shows for it. */
export async function storePage<TEntry>(
  offer: Offer,
  entry: TEntry,
  readMedia: StoreMediaReader,
): Promise<MiniAppStorePage<TEntry>> {
  const { store } = offer
  const readme = store.readme
    ? await readMedia
        .read(offer, 'readme')
        .then(({ bytes }) => new TextDecoder().decode(bytes))
        .catch(() => null)
    : null
  return {
    entry,
    readme,
    screenshots: store.screenshots.map((shot, index) => ({
      url: storeMediaUrl(offer.name, 'screenshot', shot, index),
      ...(shot.caption ? { caption: shot.caption } : {}),
    })),
    details: {
      ...(offer.version ? { version: offer.version } : {}),
      ...(offer.apiVersion ? { apiVersion: offer.apiVersion } : {}),
      size: offer.archive.bytes,
      ...(store.license ? { license: store.license } : {}),
      ...(store.author ? { author: store.author } : {}),
      ...(store.homepage ? { homepage: store.homepage } : {}),
      ...(store.surfaces ? { surfaces: store.surfaces } : {}),
      ...(store.commands ? { commands: store.commands.length } : {}),
    },
  }
}
