import {
  hasUpdate,
  isActiveJob,
  type ListingRef,
  type ListingsResponse,
  type PackageKind,
  type Scope,
  type SourceView,
  type StoreActivity,
  type StoreActor,
  type StoreProvider,
} from '@localixai/store'

import { ConflictError, NotFoundError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import { createListingIndex, type ListingIndex, type ListingQuery } from './listing-index'

interface Built {
  generation: number
  index: Promise<{ index: ListingIndex; problems: string[] }>
}

/**
 * THE STORE (`docs/internals/store.md`): the one place that lists, installs, updates and removes
 * every package kind. It holds the providers `bootstrap/` hands it (A4) and imports no feature
 * (A6, X1); everything it shows is a listing a provider projected. Its index is derived: rebuilt
 * from the providers after any of them, or a change notice, says something moved (P9).
 */
export function createStoreService(deps: { providers: readonly StoreProvider[] }) {
  const providers = new Map(deps.providers.map((provider) => [provider.kind, provider]))
  const listeners = new Set<() => void>()
  const built = new Map<string, Built>()
  let generation = 0

  const invalidate = () => {
    generation++
    for (const listener of listeners) listener()
  }
  for (const provider of deps.providers) provider.subscribe(invalidate)

  const providerOf = (kind: PackageKind): StoreProvider => {
    const provider = providers.get(kind)
    if (!provider)
      throw new NotFoundError('store_kind_unknown', `The Store has no ${kind} packages`)
    return provider
  }
  const unsupported = (kind: PackageKind, what: string) =>
    new ConflictError('store_unsupported', `${kind} packages cannot ${what}`)

  async function build(actor: StoreActor) {
    const answers = await Promise.all(
      deps.providers.map((provider) =>
        provider.listings(actor).catch((error: unknown) => ({
          listings: [],
          problems: [errorMessage(error)],
        })),
      ),
    )
    return {
      index: createListingIndex(answers.flatMap((answer) => answer.listings)),
      problems: answers.flatMap((answer) => answer.problems),
    }
  }

  /** The person's index, rebuilt once something changed since it was built. */
  function indexFor(actor: StoreActor) {
    const current = built.get(actor.userId)
    if (current?.generation === generation) return current.index
    const next = { generation, index: build(actor) }
    built.set(actor.userId, next)
    // A failed build is not kept: the next read tries again.
    next.index.catch(() => built.delete(actor.userId))
    return next.index
  }

  return {
    /** A change notice the Store did not hear from a provider (`bootstrap/` relays them). */
    invalidate,

    /** Hear every change to what the Store would list; returns the unsubscribe. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async listings(actor: StoreActor, query: ListingQuery): Promise<ListingsResponse> {
      const { index, problems } = await indexFor(actor)
      return { listings: index.query(query), facets: index.facets(), problems }
    },

    detail: async (ref: ListingRef, actor: StoreActor) =>
      providerOf(ref.kind).detail(ref.id, actor),

    plan: async (ref: ListingRef, scope: Scope, actor: StoreActor) =>
      providerOf(ref.kind).plan(ref.id, scope, actor),

    install: async (ref: ListingRef, scope: Scope, consent: { plan: boolean }, actor: StoreActor) =>
      providerOf(ref.kind).install(ref.id, scope, consent, actor),

    update: async (ref: ListingRef, scope: Scope, actor: StoreActor) =>
      providerOf(ref.kind).update(ref.id, scope, actor),

    remove: async (ref: ListingRef, scope: Scope, actor: StoreActor) =>
      providerOf(ref.kind).remove(ref.id, scope, actor),

    async setEnabled(ref: ListingRef, scope: Scope, enabled: boolean, actor: StoreActor) {
      const provider = providerOf(ref.kind)
      if (!provider.setEnabled) throw unsupported(ref.kind, 'be switched off')
      await provider.setEnabled(ref.id, scope, enabled, actor)
    },

    async sources(): Promise<SourceView[]> {
      return (await Promise.all(deps.providers.map((provider) => provider.sources()))).flat()
    },

    async previewSource(kind: PackageKind, input: string) {
      const provider = providerOf(kind)
      if (!provider.previewSource) throw unsupported(kind, 'add a source')
      return provider.previewSource(input)
    },

    async addSource(kind: PackageKind, input: string) {
      const provider = providerOf(kind)
      if (!provider.addSource) throw unsupported(kind, 'add a source')
      await provider.addSource(input)
    },

    async removeSource(kind: PackageKind, id: string) {
      const provider = providerOf(kind)
      if (!provider.removeSource) throw unsupported(kind, 'remove a source')
      await provider.removeSource(id)
    },

    /** The jobs in flight and the updates offered, from the index: it reads no source. */
    async activity(actor: StoreActor): Promise<StoreActivity> {
      const { index } = await indexFor(actor)
      const jobs: StoreActivity['jobs'] = []
      const updates: StoreActivity['updates'] = []
      for (const listing of index.all()) {
        const label = {
          ref: listing.ref,
          displayName: listing.displayName,
          ...(listing.icon ? { icon: listing.icon } : {}),
        }
        if (listing.job && isActiveJob(listing.job))
          jobs.push({
            ...label,
            ...(listing.version ? { version: listing.version } : {}),
            ...listing.job,
          })
        else if (hasUpdate(listing))
          for (const install of listing.installs)
            if (install.updateTo)
              updates.push({
                ...label,
                ...(install.version ? { from: install.version } : {}),
                to: install.updateTo,
              })
      }
      return { jobs, updates }
    },

    /**
     * Update all: every provider re-reads its sources, then each install a newer version is
     * offered for is updated, unless a job already runs for it. Returns what was queued.
     */
    async applyUpdates(actor: StoreActor): Promise<ListingRef[]> {
      await Promise.all(deps.providers.map((provider) => provider.refresh()))
      invalidate()
      const { index } = await indexFor(actor)
      const queued: ListingRef[] = []
      for (const listing of index.all()) {
        if (!hasUpdate(listing) || isActiveJob(listing.job)) continue
        const scopes = listing.installs.filter((install) => install.updateTo)
        try {
          for (const { scope } of scopes)
            await providerOf(listing.ref.kind).update(listing.ref.id, scope, actor)
          queued.push(listing.ref)
        } catch {
          // Its provider refused (a folder of the person's own by that name): the rest still go.
        }
      }
      return queued
    },
  }
}

export type StoreService = ReturnType<typeof createStoreService>
