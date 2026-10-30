import type { MiniAppCatalogEditorial } from './catalog-feed'
import { join } from 'node:path'

import { ConflictError, NotFoundError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import { MINI_APPS_SUBDIR } from './paths'
import {
  ACTIVE_PHASES,
  isIncompatible as incompatible,
  isUpdatable,
  type MiniAppInstallOutcome,
} from './store-activity'
import { storePage, type MiniAppStorePage } from './store-detail'
import { storeEntry, type MiniAppJob, type MiniAppStoreEntry } from './store-entry'
import { installedBy, installOffer } from './store-install'
import { createStoreMediaReader, type StoreMediaKind } from './store-media'
import {
  createOfferReader,
  readManifest,
  type MiniAppStoreSource,
  type Offer,
} from './store-offers'

export type { MiniAppPublisher, MiniAppStoreSource } from './store-offers'
export type { MiniAppInstallOutcome } from './store-activity'

/**
 * The mini app store: what the catalogs offer, what is installed, and the installs in flight
 * (`docs/internals/plugins-and-mini-apps.md`, "Catalogs and sources"). Nothing is installed until
 * the person chooses it (rule X5), but the apps Localix recommends (`recommended.ts`). An install is in-memory status — every move of a job tells the
 * subscribers, the Store among them, whose `store` poke tells the client to read again — and a finished one
 * is announced through `onInstalled`. When the queue drains, how each install went is handed to
 * `onJobsSettled`, which records it in the person's journal (the owner announces).
 */

export type { MiniAppJob, MiniAppJobPhase, MiniAppStoreEntry } from './store-entry'

export interface MiniAppStoreListing {
  entries: MiniAppStoreEntry[]
  /** Sources that could not be read this time, each said in a sentence. */
  problems: string[]
  /** Why a source could not be read this time, by its address. */
  failed: Record<string, string>
  /** What the catalogs Localix vouches for pick for the Store's Discover, by catalog. */
  editorial: Array<{ source: string; editorial: MiniAppCatalogEditorial }>
}

/** A catalog's store media, kept by hash once fetched. */
export const MINI_APP_STORE_CACHE_SUBDIR = '.localix/cache/mini-app-store'

export function createMiniAppStore(deps: {
  homeDir: string
  /** Read per call: the person adds and removes catalogs while the API runs. */
  sources: () => MiniAppStoreSource[] | Promise<MiniAppStoreSource[]>
  /**
   * An install finished: announce the app (the owner announces, C1) and, for a `fresh` one the
   * person chose, record their yes to run it.
   */
  onInstalled: (name: string, info: { fresh: boolean; userId?: string }) => Promise<void>
  /** The queue drained: how every install since the last drain went, in the order they ran. */
  onJobsSettled?: (outcomes: MiniAppInstallOutcome[]) => void
  fetchImpl?: typeof fetch
  /** Where a catalog's media are kept once fetched; under the Localix cache by default. */
  cacheDir?: string
  /** Keep the key a catalog a person added was first read signed with (`catalogs.ts`). */
  pinKey?: (url: string, key: string) => Promise<void>
  /** The keys kept for catalogs a list links to (`catalogs.ts`). */
  linkedKeys?: {
    get(url: string): Promise<string | undefined>
    pin(url: string, key: string): Promise<void>
  }
  /** The installed apps the person keeps from updating on their own (`auto-update.ts`). */
  autoUpdateOff?: () => Promise<ReadonlySet<string>>
}) {
  const installRoot = join(deps.homeDir, MINI_APPS_SUBDIR)
  const readOffers = createOfferReader({
    sources: deps.sources,
    fetchImpl: deps.fetchImpl,
    ...(deps.pinKey ? { pinKey: deps.pinKey } : {}),
    ...(deps.linkedKeys ? { linkedKeys: deps.linkedKeys } : {}),
  })
  const readMedia = createStoreMediaReader({
    cacheDir: deps.cacheDir ?? join(deps.homeDir, MINI_APP_STORE_CACHE_SUBDIR),
    fetchImpl: deps.fetchImpl,
  })
  const jobs = new Map<string, MiniAppJob>()
  let outcomes: MiniAppInstallOutcome[] = []
  const listeners = new Set<() => void>()
  let queue: Promise<void> = Promise.resolve()
  const setJob = (name: string, job: MiniAppJob) => {
    jobs.set(name, job)
    for (const listener of listeners) listener()
  }
  const busy = (name: string) => ACTIVE_PHASES.has(jobs.get(name)?.phase ?? 'done')

  async function run(offer: Offer, userId: string | undefined): Promise<void> {
    const fresh = (await installedBy(join(installRoot, offer.name))) === null
    const label = offer.displayName ?? offer.name
    const kind = fresh ? 'install' : 'update'
    const outcome = {
      name: offer.name,
      label,
      kind,
      ...(offer.version ? { version: offer.version } : {}),
      ...(userId ? { userId } : {}),
    } as const
    setJob(offer.name, { phase: 'downloading', received: 0, total: offer.archive.bytes })
    try {
      await installOffer(offer, deps.homeDir, {
        fetchImpl: deps.fetchImpl,
        onProgress: ({ received, total }) =>
          setJob(offer.name, { phase: 'downloading', received, total }),
      })
      setJob(offer.name, { phase: 'installing' })
      await deps.onInstalled(offer.name, { fresh, ...(userId ? { userId } : {}) })
      setJob(offer.name, { phase: 'done' })
      outcomes.push(outcome)
    } catch (error) {
      setJob(offer.name, { phase: 'failed', error: errorMessage(error) })
      outcomes.push({ ...outcome, error: errorMessage(error) })
    }
  }

  /** After each job: once nothing is left in flight, say how every one since the last drain went. */
  const reportIfDrained = () => {
    if ([...jobs.keys()].some(busy) || outcomes.length === 0) return
    const settled = outcomes
    outcomes = []
    deps.onJobsSettled?.(settled)
  }

  const toEntry = async (offer: Offer): Promise<MiniAppStoreEntry> =>
    storeEntry(
      offer,
      await readManifest(join(installRoot, offer.name)),
      await isUpdatable(offer, installRoot),
      jobs.get(offer.name),
    )

  const offerNamed = async (name: string): Promise<Offer> => {
    const offer = (await readOffers()).offers.get(name)
    if (!offer)
      throw new NotFoundError(
        'mini_app_not_offered',
        `No catalog offers a mini app named "${name}"`,
      )
    return offer
  }

  const enqueue = (offer: Offer, userId?: string) => {
    setJob(offer.name, { phase: 'queued' })
    queue = queue.then(() => run(offer, userId)).then(reportIfDrained)
  }

  return {
    async list(): Promise<MiniAppStoreListing> {
      const { offers, problems, failed, editorial } = await readOffers()
      const entries = await Promise.all([...offers.values()].map(toEntry))
      const sorted = entries.sort((a, b) => a.name.localeCompare(b.name))
      return { entries: sorted, problems, failed, editorial }
    },

    /** One app's store page: its row, README, screenshots and what it brings. */
    async detail(name: string): Promise<MiniAppStorePage<MiniAppStoreEntry>> {
      const offer = await offerNamed(name)
      return storePage(offer, await toEntry(offer), readMedia)
    },

    /** One of an app's store files, checked to be what it claims (`store-media.ts`). */
    async media(name: string, kind: StoreMediaKind, index?: number) {
      return readMedia.read(await offerNamed(name), kind, index)
    },

    /**
     * Queue an install; it runs after the ones before it and resolves once queued. Refused at
     * once — before anything is downloaded — for an app no catalog offers, one built for a newer
     * Localix, a folder of the person's own by that name, or an unverified publisher the person
     * has not said yes to.
     */
    async install(
      name: string,
      opts: { userId?: string; acceptUnverified?: boolean } = {},
    ): Promise<void> {
      if (busy(name)) return
      const offer = await offerNamed(name)
      if (incompatible(offer))
        throw new ConflictError(
          'mini_app_incompatible',
          `"${name}" needs a newer Localix (mini app API ${offer.apiVersion}); update Localix first`,
        )
      const by = await installedBy(join(installRoot, name))
      if (by === 'person')
        throw new ConflictError(
          'mini_app_name_taken',
          `A mini app of yours is already called "${name}"; rename or remove it first`,
        )
      // The catalog is no longer signed by the key kept for it: someone else may have written it.
      if (offer.signature === 'mismatch')
        throw new ConflictError(
          'mini_app_signature_changed',
          `"${name}" comes from a catalog whose signature changed (${offer.source}); nothing is installed from it until it is removed and added again`,
        )
      if (!offer.publisher.verified && !opts.acceptUnverified)
        throw new ConflictError(
          'mini_app_unverified',
          `"${name}" comes from an unverified publisher (${offer.publisher.name}); confirm to install it`,
        )
      // Asked again while the checks above waited (a double click): the job that got there first
      // is the one running.
      if (busy(name)) return
      enqueue(offer, opts.userId)
    },

    /**
     * Install the newer version of every app a catalog put here, re-reading the catalogs first.
     * Only from a catalog signed with the key kept for it, and not for an app the person keeps
     * from updating on its own: the rest wait for the person's Update. A folder the person made,
     * an incompatible version and a running job are left alone; a failed update keeps the version
     * before. Returns the names queued.
     */
    async updateInstalled(): Promise<string[]> {
      const { offers } = await readOffers({ fresh: true })
      const off = (await deps.autoUpdateOff?.()) ?? new Set<string>()
      const queued: string[] = []
      for (const offer of offers.values()) {
        if (offer.signature !== 'signed' || off.has(offer.name)) continue
        // A copy an earlier Localix build installed moves to the catalog's on its next version; a
        // folder the person made is theirs (`isUpdatable`).
        if (busy(offer.name) || !(await isUpdatable(offer, installRoot))) continue
        enqueue(offer)
        queued.push(offer.name)
      }
      return queued
    },

    /** Read every catalog again, so the next list is fresh; tells the subscribers. */
    async refresh(): Promise<void> {
      await readOffers({ fresh: true })
      for (const listener of listeners) listener()
    },

    /** A catalog's icon, checked against its pin, for a catalog not added yet. */
    catalogImage: readMedia.catalogImage,

    /** Resolves when every queued install has finished (tests, shutdown). */
    settled: () => queue,

    jobs: (): ReadonlyMap<string, MiniAppJob> => jobs,

    /** Hear every move of a job; returns the unsubscribe. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export type MiniAppStore = ReturnType<typeof createMiniAppStore>
