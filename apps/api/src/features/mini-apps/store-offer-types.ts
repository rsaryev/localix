import type { ListingSuits } from '@localixai/store'

import type { CatalogSignatureState } from './catalog-signature'

/** Who publishes an app, and whether Localix vouches for them. */
export interface MiniAppPublisher {
  name: string
  verified: boolean
}

/**
 * Where offers come from: a `catalog.json` over HTTPS or `file://`. Its publishers are verified
 * only when the source `vouches` — the hosted Localix catalog does; one a person added does not.
 * `key` is the public key its signature must hold for (`catalog-signature.ts`): pinned in code for
 * the Localix catalog, kept from the first signed read for one a person added.
 */
export type MiniAppStoreSource = { kind: 'catalog'; url: string; vouches: boolean; key?: string }

/**
 * One file of an app's store page: a catalog's pinned file. It reaches a client only as a host
 * address (`store-media.ts`), never as where it lives.
 */
export type OfferFile = {
  from: 'catalog'
  url: string
  bytes: number
  sha256: string
  type: string
}

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
  /** What it is for, for recommendations; set only by a catalog Localix vouches for. */
  suits?: ListingSuits
  /** The kinds of file it opens (`docx`, `request.json`), from its `fileAssociations`. */
  opens?: string[]
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
  /** Whether its catalog is signed with the key kept for it: only `signed` updates on its own. */
  signature: CatalogSignatureState
  store: OfferStore
}

/** One app a source offers, and how to get it. */
export type Offer = OfferMeta & {
  from: 'catalog'
  catalog: string
  archive: { url: string; bytes: number; sha256: string }
}
