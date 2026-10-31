import { join } from 'node:path'

import { ConflictError, NotFoundError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import { MINI_APPS_SUBDIR } from './paths'
import {
  ACTIVE_PHASES,
  holdsOffer,
  isIncompatible as incompatible,
  isUpdatable,
  type MiniAppInstallOutcome,
} from './store-activity'
import { storePage, type MiniAppStorePage } from './store-detail'
import { storeEntry, type MiniAppJob, type MiniAppStoreEntry } from './store-entry'
import { installedBy, installOffer, readInstallRecord } from './store-install'
import { createStoreMediaReader, type StoreMediaKind } from './store-media'
import {
  createOfferReader,
  readManifest,
  type MiniAppMarketplaceSource,
  type Offer,
  type OfferRead,
  type OfferTrust,
} from './store-offers'

export type { MiniAppPublisher, MiniAppMarketplaceSource, OfferTrust } from './store-offers'
export type { MiniAppInstallOutcome } from './store-activity'

/**
 * The mini app store: what the marketplaces offer, what is installed, and the installs in flight
 * (`docs/extending/mini-app-marketplace.md`). An app is its identity, `<name>@<marketplace>`; its
 * folder is its name, so one app by a name is installed at a time, and only its own marketplace
 * updates it. Nothing is installed until the person chooses it (rule X5), but the apps a
 * marketplace Localix vouches for installs by default (`recommended.ts`). An install is in-memory
 * status — every move of a job tells the subscribers, the Store among them, whose `store` poke
 * tells the client to read again — and a finished one is announced through `onInstalled`. When
 * the queue drains, how each install went is handed to `onJobsSettled`, which records it in the
 * person's journal (the owner announces).
 */

export type { MiniAppJob, MiniAppJobPhase, MiniAppStoreEntry } from './store-entry'

export interface MiniAppStoreListing extends Omit<OfferRead, 'offers'> {
  entries: MiniAppStoreEntry[]
}

/** A marketplace's store media, kept by hash once fetched. */
export const MINI_APP_STORE_CACHE_SUBDIR = '.localix/cache/mini-app-store'

/** An app's folder name: its identity's first half. */
export const appNameOf = (ref: string) => ref.split('@')[0] ?? ref

export function createMiniAppStore(deps: {
  homeDir: string
  /** Read per call: the person adds and removes marketplaces while the API runs. */
  sources: () => MiniAppMarketplaceSource[] | Promise<MiniAppMarketplaceSource[]>
  /** What Localix keeps to judge each marketplace's signatures (`marketplaces.ts`). */
  trust: OfferTrust
  /**
   * An install finished: announce the app (the owner announces, C1) and, for a `fresh` one the
   * person chose, record their yes to run it.
   */
  onInstalled: (name: string, info: { fresh: boolean; userId?: string }) => Promise<void>
  /** The queue drained: how every install since the last drain went, in the order they ran. */
  onJobsSettled?: (outcomes: MiniAppInstallOutcome[]) => void
  /** Every fresh read of the marketplaces, for what they took back (`revocations.ts`). */
  onRead?: (read: OfferRead) => Promise<void>
  fetchImpl?: typeof fetch
  /** Where marketplaces' media are kept once fetched; under the Localix cache by default. */
  cacheDir?: string
  /** The installed apps the person keeps from updating on their own (`auto-update.ts`). */
  autoUpdateOff?: () => Promise<ReadonlySet<string>>
}) {
  const installRoot = join(deps.homeDir, MINI_APPS_SUBDIR)
  const readOffers = createOfferReader({
    sources: deps.sources,
    trust: deps.trust,
    fetchImpl: deps.fetchImpl,
  })
  const readFresh = async () => {
    const read = await readOffers({ fresh: true })
    await deps.onRead?.(read)
    return read
  }
  const readMedia = createStoreMediaReader({
    cacheDir: deps.cacheDir ?? join(deps.homeDir, MINI_APP_STORE_CACHE_SUBDIR),
    fetchImpl: deps.fetchImpl,
  })
  // By folder name, since one app by a name is on this machine at a time, and which app it is.
  const jobs = new Map<string, MiniAppJob>()
  const jobFor = new Map<string, string>()
  let outcomes: MiniAppInstallOutcome[] = []
  const listeners = new Set<() => void>()
  let queue: Promise<void> = Promise.resolve()
  const setJob = (offer: Offer, job: MiniAppJob) => {
    jobs.set(offer.name, job)
    jobFor.set(offer.name, offer.id)
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
    setJob(offer, { phase: 'downloading', received: 0, total: offer.archive.bytes })
    try {
      await installOffer(offer, deps.homeDir, {
        fetchImpl: deps.fetchImpl,
        onProgress: ({ received, total }) =>
          setJob(offer, { phase: 'downloading', received, total }),
      })
      setJob(offer, { phase: 'installing' })
      await deps.onInstalled(offer.name, { fresh, ...(userId ? { userId } : {}) })
      setJob(offer, { phase: 'done' })
      outcomes.push(outcome)
    } catch (error) {
      setJob(offer, { phase: 'failed', error: errorMessage(error) })
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

  const toEntry = async (offer: Offer): Promise<MiniAppStoreEntry> => {
    const holds = await holdsOffer(offer, installRoot)
    return storeEntry(
      offer,
      holds ? await readManifest(join(installRoot, offer.name)) : null,
      await isUpdatable(offer, installRoot, holds),
      jobFor.get(offer.name) === offer.id ? jobs.get(offer.name) : undefined,
    )
  }

  /**
   * The offer `ref` names: an identity, or a name alone — the app installed by that name, else the
   * first marketplace's (Localix's own come first).
   */
  const offerFor = async (ref: string): Promise<Offer> => {
    const { offers } = await readOffers()
    let offer = offers.get(ref)
    if (!offer && !ref.includes('@')) {
      const record = await readInstallRecord(join(installRoot, ref))
      offer = record
        ? offers.get(`${ref}@${record.marketplace}`)
        : [...offers.values()].find((found) => found.name === ref)
    }
    if (!offer)
      throw new NotFoundError('mini_app_not_offered', `No marketplace offers the mini app "${ref}"`)
    return offer
  }

  /** Why `offer` may not replace what its name holds now, or null. */
  async function nameConflict(offer: Offer): Promise<string | null> {
    const dir = join(installRoot, offer.name)
    const by = await installedBy(dir)
    if (by === 'person')
      return `A mini app of yours is already called "${offer.name}"; rename or remove it first`
    if (!by || (await holdsOffer(offer, installRoot))) return null
    const record = await readInstallRecord(dir)
    const holder = record ? `"${offer.name}" from ${record.marketplace}` : `"${offer.name}"`
    return `${holder} is installed; remove it to install the one from ${offer.marketplace}`
  }

  const enqueue = (offer: Offer, userId?: string) => {
    setJob(offer, { phase: 'queued' })
    queue = queue.then(() => run(offer, userId)).then(reportIfDrained)
  }

  return {
    async list(): Promise<MiniAppStoreListing> {
      const { offers, ...read } = await readOffers()
      const entries = await Promise.all([...offers.values()].map(toEntry))
      const sorted = entries.sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      )
      return { entries: sorted, ...read }
    },

    /** One app's store page: its row, README, screenshots and what it brings. */
    async detail(ref: string): Promise<MiniAppStorePage<MiniAppStoreEntry>> {
      const offer = await offerFor(ref)
      return storePage(offer, await toEntry(offer), readMedia)
    },

    /** One of an app's store files, checked to be what it claims (`store-media.ts`). */
    async media(ref: string, kind: StoreMediaKind, index?: number) {
      return readMedia.read(await offerFor(ref), kind, index)
    },

    /**
     * Queue an install; it runs after the ones before it and resolves once queued. Refused at
     * once — before anything is downloaded — for an app no marketplace offers, one built for a
     * newer Localix, a name another app already holds here, a marketplace whose signature changed,
     * an archive Localix blocks, or an unverified publisher the person has not said yes to.
     */
    async install(
      ref: string,
      opts: { userId?: string; acceptUnverified?: boolean } = {},
    ): Promise<void> {
      const offer = await offerFor(ref)
      const { name } = offer
      if (busy(name)) return
      if (incompatible(offer))
        throw new ConflictError(
          'mini_app_incompatible',
          `"${name}" needs a newer Localix (mini app API ${offer.apiVersion}); update Localix first`,
        )
      const conflict = await nameConflict(offer)
      if (conflict) throw new ConflictError('mini_app_name_taken', conflict)
      // The marketplace is no longer signed by a key kept for it: someone else may have written it.
      if (offer.signature === 'mismatch')
        throw new ConflictError(
          'mini_app_signature_changed',
          `"${name}" comes from a marketplace whose signature changed (${offer.from}); nothing installs from it until it is removed and added again`,
        )
      const blocked = (await readOffers()).blocked.find(
        (found) => found.sha256 === offer.archive.sha256,
      )
      if (blocked)
        throw new ConflictError(
          'mini_app_blocked',
          `Localix blocks this build of "${name}": ${blocked.reason}`,
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
     * Install the newer version of every app a marketplace put here, re-reading the marketplaces
     * first. Only from the marketplace that installed it, signed with a key kept for it, and not
     * for an app the person keeps from updating on its own: the rest wait for the person's Update.
     * A folder the person made, an incompatible version, a blocked archive and a running job are
     * left alone; a failed update keeps the version before. Returns the names queued.
     */
    async updateInstalled(): Promise<string[]> {
      const { offers, blocked } = await readFresh()
      const off = (await deps.autoUpdateOff?.()) ?? new Set<string>()
      const refused = new Set(blocked.map((found) => found.sha256))
      const queued: string[] = []
      for (const offer of offers.values()) {
        if (offer.signature !== 'signed' || off.has(offer.name)) continue
        if (refused.has(offer.archive.sha256)) continue
        if (busy(offer.name) || !(await isUpdatable(offer, installRoot))) continue
        enqueue(offer)
        queued.push(offer.name)
      }
      return queued
    },

    /** Read every marketplace again, so the next list is fresh; tells the subscribers. */
    async refresh(): Promise<void> {
      await readFresh()
      for (const listener of listeners) listener()
    },

    /** A marketplace's icon, checked against its pin, for a marketplace not added yet. */
    marketplaceImage: readMedia.marketplaceImage,

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
