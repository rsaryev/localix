import type { MarketplaceSignatureState } from '@localixai/mini-app-sdk/marketplace-signature'
import type { SuggestFor } from '@localixai/store'

import { iconOf, isIncompatible } from './store-activity'
import type { MiniAppPublisher, Offer } from './store-offer-types'

/** One app's row in the store (`store.ts`): what a marketplace offers, beside what is installed. */

export type MiniAppJobPhase = 'queued' | 'downloading' | 'installing' | 'done' | 'failed'

export interface MiniAppJob {
  phase: MiniAppJobPhase
  /** While downloading: bytes so far, and of how many. */
  received?: number
  total?: number
  error?: string
}

export interface MiniAppStoreEntry {
  /** Its identity, `<name>@<marketplace>`; an app the person made is its name alone. */
  id: string
  name: string
  /** The marketplace that offers it, by name; absent for an app the person made. */
  marketplace?: string
  displayName?: string
  description: string
  category?: string
  /** The version its marketplace offers. */
  version?: string
  publisher: MiniAppPublisher
  /** The marketplace it comes from, by address, as the marketplace list names it. */
  source: string
  /** The released marketplace its archive comes from: its own, or its author's when linked. */
  from?: string
  /** Whether its marketplace is signed with a key kept for it; absent with no marketplace. */
  signature?: MarketplaceSignatureState
  /** Where the host serves its icon; the row draws a monogram when it has none. */
  icon?: string
  tags?: string[]
  /** In the Featured group above the rest (a marketplace Localix vouches for only). */
  featured?: boolean
  /** Installed on its own on a new installation (a vouched marketplace only, `recommended.ts`). */
  installByDefault?: boolean
  /** What it is suggested for (a vouched marketplace only). */
  suggestFor?: SuggestFor
  /** The kinds of file it opens (`docx`, `request.json`). */
  opens?: string[]
  surfaces?: string[]
  /** The names of the `/<app>:<command>` commands its manifest declares. */
  commands?: string[]
  /** This app as it is on this machine, or null: another app by its name is not it. */
  installed: { version?: string } | null
  /** Its marketplace offers another version of the installed copy (`isUpdatable`). */
  update: boolean
  /** Built for a newer mini app contract than this Localix runs: it cannot be installed. */
  incompatible?: boolean
  /** The installed copy's marketplace took it back, and why: it does not run. */
  revoked?: string
  job?: MiniAppJob
}

/**
 * The store row for `offer`, given the manifest of this very app installed (`holdsOffer`), whether
 * the offer may update that copy, and its job in flight.
 */
export function storeEntry(
  offer: Offer,
  installed: Record<string, unknown> | null | undefined,
  updatable: boolean,
  job: MiniAppJob | undefined,
): MiniAppStoreEntry {
  const installedVersion = typeof installed?.version === 'string' ? installed.version : undefined
  const { tags, featured, installByDefault, suggestFor, opens, surfaces, commands } = offer.store
  const icon = iconOf(offer)
  return {
    id: offer.id,
    name: offer.name,
    marketplace: offer.marketplace,
    ...(offer.displayName ? { displayName: offer.displayName } : {}),
    description: offer.description,
    ...(offer.category ? { category: offer.category } : {}),
    ...(offer.version ? { version: offer.version } : {}),
    publisher: offer.publisher,
    source: offer.source,
    from: offer.from,
    signature: offer.signature,
    ...(icon ? { icon } : {}),
    ...(tags.length ? { tags } : {}),
    ...(featured ? { featured: true } : {}),
    ...(installByDefault ? { installByDefault: true } : {}),
    ...(suggestFor ? { suggestFor } : {}),
    ...(opens ? { opens } : {}),
    ...(surfaces ? { surfaces } : {}),
    ...(commands?.length ? { commands } : {}),
    installed: installed ? (installedVersion ? { version: installedVersion } : {}) : null,
    update: Boolean(installed && offer.version && updatable),
    ...(isIncompatible(offer) ? { incompatible: true } : {}),
    ...(job ? { job } : {}),
  }
}
