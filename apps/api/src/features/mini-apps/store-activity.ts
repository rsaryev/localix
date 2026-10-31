import { join } from 'node:path'
import { MINI_APP_API_VERSION } from '@localixai/mini-app-sdk/manifest-primitives'

import { apiVersionTooNew } from '../ext/manifest-validate'

import { installedBy, readInstallRecord } from './store-install'
import { storeMediaUrl } from './store-media'
import { readManifest, type Offer } from './store-offers'
import type { MiniAppJob } from './store'

/**
 * The mini app store's jobs and offers as the Store reads them: which phases are in flight, what
 * this Localix cannot run, an offer's icon, and whether Update all would take an offer. The Event
 * Center and the update strip read the Store's own activity (`/rpc/store/activity`).
 */

/** How one finished install or update went, as the owner reports it (`onJobsSettled`). */
export interface MiniAppInstallOutcome {
  name: string
  /** Its display name, or its name. */
  label: string
  kind: 'install' | 'update'
  version?: string
  /** Set when it did not install: the version before keeps running. */
  error?: string
  /** Who asked for it; an update on its own was asked for by nobody. */
  userId?: string
}

export const ACTIVE_PHASES: ReadonlySet<MiniAppJob['phase']> = new Set([
  'queued',
  'downloading',
  'installing',
])

/** Built for a newer mini app contract than this Localix runs. */
export const isIncompatible = (offer: Offer) =>
  apiVersionTooNew('Mini app', MINI_APP_API_VERSION, offer.apiVersion) !== null

export const iconOf = (offer: Offer) =>
  offer.store.icon ? storeMediaUrl(offer.id, 'icon', offer.store.icon) : undefined

/**
 * Whether the folder under the offer's name holds this very app: one its marketplace installed —
 * the same name from another marketplace is another app — or a copy an earlier Localix build put
 * there, which is Localix's own and moves to the marketplace Localix vouches for.
 */
export async function holdsOffer(offer: Offer, installRoot: string): Promise<boolean> {
  const dir = join(installRoot, offer.name)
  const by = await installedBy(dir)
  if (by === 'staged') return offer.publisher.verified
  return by === 'marketplace' && (await readInstallRecord(dir))?.marketplace === offer.marketplace
}

/**
 * Whether Update all would take this offer: this very app installed (`holdsOffer`, passed in when
 * the caller already asked), at another version, that this Localix can run. A folder the person
 * made is theirs.
 */
export async function isUpdatable(
  offer: Offer,
  installRoot: string,
  holds?: boolean,
): Promise<boolean> {
  if (isIncompatible(offer) || !(holds ?? (await holdsOffer(offer, installRoot)))) return false
  return (await readManifest(join(installRoot, offer.name)))?.version !== offer.version
}
