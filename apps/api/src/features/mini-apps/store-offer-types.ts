import type { BlockedArchive } from '@localixai/mini-app-sdk/marketplace'
import type { MarketplaceSignatureState } from '@localixai/mini-app-sdk/marketplace-signature'
import type { Editorial, SuggestFor } from '@localixai/store'

/** Who publishes an app — its marketplace's owner — and whether Localix vouches for them. */
export interface MiniAppPublisher {
  name: string
  verified: boolean
}

/**
 * One file of an app's store page: a marketplace's pinned file. It reaches a client only as a
 * host address (`store-media.ts`), never as where it lives.
 */
export type OfferFile = {
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
  /** In the Featured group; set only by a marketplace Localix vouches for. */
  featured?: boolean
  /** Installed on its own on a new installation; set only by a marketplace Localix vouches for. */
  installByDefault?: boolean
  /** What it is suggested for; set only by a marketplace Localix vouches for. */
  suggestFor?: SuggestFor
  /** The kinds of file it opens (`docx`, `request.json`), from its `fileAssociations`. */
  opens?: string[]
  surfaces?: string[]
  commands?: string[]
}

/** What an app is, as an offer shows it. */
export interface OfferMeta {
  /** Its identity, `<name>@<marketplace>`. */
  id: string
  name: string
  /** The marketplace that lists it, by name. */
  marketplace: string
  displayName?: string
  description: string
  category?: string
  version?: string
  apiVersion?: number
  publisher: MiniAppPublisher
  /** The marketplace that lists it, by address, as the source list names it. */
  source: string
  /** Whether the marketplace it installs from is signed with a key kept for it. */
  signature: MarketplaceSignatureState
  store: OfferStore
}

/** One app a marketplace offers, and how to get it. */
export type Offer = OfferMeta & {
  /** The released marketplace its archive comes from: its own, or its author's when linked. */
  from: string
  archive: { url: string; bytes: number; sha256: string }
}

/** An app a marketplace took back, by the identity it is installed under. */
export interface Revocation {
  id: string
  name: string
  marketplace: string
  reason: string
  /** The versions taken back; absent, every version. */
  versions?: string[]
}

export type { BlockedArchive }

/** Everything the marketplaces say, read together. */
export interface OfferRead {
  /** Every app on offer, by identity. */
  offers: Map<string, Offer>
  problems: string[]
  /** Why a marketplace could not be read this time, by its address. */
  failed: Record<string, string>
  /** What the marketplaces Localix vouches for pick for Discover, by address. */
  editorial: Array<{ source: string; collections: Editorial['collections'] }>
  revocations: Revocation[]
  /** Archives Localix blocks whatever marketplace they came from. */
  blocked: BlockedArchive[]
}
