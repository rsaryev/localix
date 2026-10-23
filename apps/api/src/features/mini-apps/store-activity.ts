import { join } from 'node:path'
import { MINI_APP_API_VERSION } from '@localixai/mini-app-sdk/manifest-primitives'

import { installedBy } from './store-install'
import { storeMediaUrl } from './store-media'
import { readManifest, type Offer } from './store-offers'
import type { MiniAppJob } from './store'

/**
 * WHAT THE STORE IS DOING IN THE BACKGROUND, for the surfaces that are always on screen (the Event
 * Center's "In progress", the composer's update strip): the installs and updates in flight, and the
 * updates the catalogs already offer. It is read on every `mini-app-installs` poke, so it never
 * reads a catalog itself — it answers from what the store last read (`cachedOnly`).
 */

/** Who an install is for and what it brings, kept beside its job while it runs. */
export interface MiniAppJobLabel {
  displayName?: string
  icon?: string
  version?: string
  /** A first copy on this machine, or a newer version over one already here. */
  kind: 'install' | 'update'
}

export interface MiniAppActivityJob extends MiniAppJob, MiniAppJobLabel {
  name: string
}

export interface MiniAppAvailableUpdate {
  name: string
  displayName?: string
  icon?: string
  from?: string
  to: string
}

export interface MiniAppStoreActivity {
  jobs: MiniAppActivityJob[]
  updates: MiniAppAvailableUpdate[]
}

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

export async function readStoreActivity(input: {
  jobs: ReadonlyMap<string, MiniAppJob>
  labels: ReadonlyMap<string, MiniAppJobLabel>
  offers: ReadonlyMap<string, Offer>
  installRoot: string
}): Promise<MiniAppStoreActivity> {
  const jobs: MiniAppActivityJob[] = []
  for (const [name, job] of input.jobs) {
    if (!ACTIVE_PHASES.has(job.phase)) continue
    jobs.push({ name, ...(input.labels.get(name) ?? { kind: 'install' }), ...job })
  }
  const updates: MiniAppAvailableUpdate[] = []
  for (const offer of input.offers.values()) {
    if (!offer.version || ACTIVE_PHASES.has(input.jobs.get(offer.name)?.phase ?? 'done')) continue
    if (!(await isUpdatable(offer, input.installRoot))) continue
    const from = (await readManifest(join(input.installRoot, offer.name)))?.version
    const icon = iconOf(offer)
    updates.push({
      name: offer.name,
      ...(offer.displayName ? { displayName: offer.displayName } : {}),
      ...(icon ? { icon } : {}),
      ...(typeof from === 'string' ? { from } : {}),
      to: offer.version,
    })
  }
  return {
    jobs: jobs.sort((a, b) => a.name.localeCompare(b.name)),
    updates: updates.sort((a, b) => a.name.localeCompare(b.name)),
  }
}
