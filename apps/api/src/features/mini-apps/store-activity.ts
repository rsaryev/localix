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
  /** Who asked for it; a catalog update was asked for by nobody. */
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
  offer.store.icon ? storeMediaUrl(offer.name, 'icon', offer.store.icon) : undefined

/**
 * Whether Update all would take this offer: an app a catalog (or an earlier Localix build) put
 * here, at another version, that this Localix can run. A folder the person made is theirs, and an
 * app updates only from the catalog that installed it: another catalog that lists the same name
 * is another publisher's app. The catalog Localix vouches for may update any copy it offers.
 */
export async function isUpdatable(offer: Offer, installRoot: string): Promise<boolean> {
  if (isIncompatible(offer)) return false
  const dir = join(installRoot, offer.name)
  if (!['catalog', 'staged'].includes((await installedBy(dir)) ?? '')) return false
  const record = await readInstallRecord(dir)
  if (record && record.catalog !== offer.catalog && !offer.publisher.verified) return false
  return (await readManifest(dir))?.version !== offer.version
}
