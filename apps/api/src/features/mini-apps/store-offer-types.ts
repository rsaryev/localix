/** Who publishes an app, and whether Localix vouches for them. */
export interface MiniAppPublisher {
  name: string
  verified: boolean
}

/**
 * Where offers come from.
 * - `local`: a folder of built apps — in development, the checkout's staged `mini-apps/`, so a
 *   change is installed without a release. Every app in it has the source's publisher.
 * - `catalog`: a `catalog.json` over HTTPS or `file://`. Its publishers are verified only when the
 *   source `vouches` — the hosted Localix catalog does; one a person added does not.
 */
export type MiniAppStoreSource =
  | { kind: 'local'; root: string; publisher: MiniAppPublisher; vouches?: boolean }
  | { kind: 'catalog'; url: string; vouches: boolean }

/**
 * Beside the apps of a local source Localix vouches for (the staged first-party folder): which of
 * them the store features and which a new installation gets on its own — the same lists the
 * release writes into its catalog (`scripts/pack-mini-apps.mjs`).
 */
export const CATALOG_PICKS_FILE = 'catalog-picks.json'

/**
 * One file of an app's store page: a path in a local app's folder, or a catalog's pinned file. It
 * reaches a client only as a host address (`store-media.ts`), never as where it lives.
 */
export type OfferFile =
  | { from: 'local'; path: string; type: string }
  | { from: 'catalog'; url: string; bytes: number; sha256: string; type: string }

/** What the store page of an app shows beside its row. */
export interface OfferStore {
  icon?: OfferFile
  screenshots: (OfferFile & { caption?: string })[]
  readme?: OfferFile
  tags: string[]
  homepage?: string
  license?: string
  author?: string
  /** In the Featured group; set only by a catalog Localix vouches for. */
  featured?: boolean
  /** Installed on its own on a new installation; set only by a catalog Localix vouches for. */
  recommended?: boolean
  surfaces?: string[]
  commands?: string[]
}

/** What an app is, as an offer shows it. */
export interface OfferMeta {
  name: string
  displayName?: string
  description: string
  category?: string
  version?: string
  apiVersion?: number
  publisher: MiniAppPublisher
  /** The catalog it comes from, as the catalog list names it (`catalogs.ts`). */
  source: string
  store: OfferStore
}

/** One app a source offers, and how to get it. */
export type Offer = OfferMeta &
  (
    | { from: 'local'; dir: string }
    | { from: 'catalog'; catalog: string; archive: { url: string; bytes: number; sha256: string } }
  )
