import { join } from 'node:path'
import { MINI_APP_API_VERSION } from '@localixai/mini-app-sdk/manifest-primitives'

import { installedBy } from './store-install'
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
export const isIncompatible = (offer: Offer) => (offer.apiVersion ?? 1) > MINI_APP_API_VERSION

export const iconOf = (offer: Offer) =>
  offer.store.icon ? storeMediaUrl(offer.name, 'icon', offer.store.icon) : undefined

/**
 * Whether Update all would take this offer: an app a catalog (or the staged first-party folder)
 * put here, at another version, that this Localix can run. A folder the person made is theirs.
 */
export async function isUpdatable(offer: Offer, installRoot: string): Promise<boolean> {
  if (offer.from !== 'catalog' || isIncompatible(offer)) return false
  const dir = join(installRoot, offer.name)
  if (!['catalog', 'staged'].includes((await installedBy(dir)) ?? '')) return false
  return (await readManifest(dir))?.version !== offer.version
}
