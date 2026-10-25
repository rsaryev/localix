import {
  LISTINGS_PAGE,
  type DiscoverResponse,
  type ListingRef,
  type ListingsResponse,
  type PackageKind,
  type Scope,
  type ShelfId,
  type SourceView,
  type StoreActivity,
  type StoreActor,
  type StoreCategory,
  type StoreProvider,
  type Trust,
} from '@localixai/store'

import { ConflictError, NotFoundError } from '../../lib/domain-errors'
import { activityOf } from './activity'
import { configService } from './config'
import { itemService } from './items'
import { discoverOf, relatedOf } from './discover'
import type { StoreIndexRepository } from './index-repository'
import { refKey } from './index-rows'
import { matching, projectAuthored, withProjectCount } from './project-authored'
import { withProjectInstalls } from './project-installs'
import { staticScore } from './ranking'
import { createStoreSearchProvider, refOfStoreHit, STORE_SEARCH_DOMAIN } from './search-provider'
import { sourcesOf } from './sources'
import { createStoreSync, watchProviders } from './store-runs'

/** What narrows a page: a shelf, a search, a scope, installed or not, and the facets' filters. */
export interface ListingQuery {
  shelf?: ShelfId
  q?: string
  scope?: Scope
  installed?: boolean
  category?: StoreCategory
  source?: string
  trust?: Trust
  projectId?: string
  cursor?: string
  limit?: number
}

/** The global search service, as the Store asks it (wired in `bootstrap/`, A4). */
export type StoreSearchPort = (
  userId: string,
  request: {
    text: string
    domains: string[]
    limit: number
    cursor?: string
    projectId?: string | null
    providerOptions: unknown
  },
) => Promise<{
  hits: Array<{ id: string }>
  nextCursor?: string
  strategy: { mode: 'lexical' | 'hybrid'; reason?: string }
}>

/**
 * THE STORE (`docs/internals/store.md`, `store-scale.md`): the one place that lists, installs,
 * updates and removes every package kind. It holds the providers `bootstrap/` hands it (A4) and
 * imports no feature that owns a kind (X1); everything it shows is a listing a provider projected
 * into its SQLite index. The index is derived: a provider's or a change notice's word that
 * something moved starts a sync off the request path, and the poke goes out once it is written
 * (P9, P11). A search goes through the global search service, to the Store's own provider there.
 */
export function createStoreService(deps: {
  providers: readonly StoreProvider[]
  index: StoreIndexRepository
  /** The global search service; it reaches the provider this service registers. */
  search: StoreSearchPort
  /** The Store's semantic collection read its listings again. */
  resyncMeaning?: () => void
  /** The open project's words, for the boost (`project-signals.ts`). */
  projectWords?: (userId: string, projectId: string | null | undefined) => Promise<Set<string>>
  now?: () => number
}) {
  const now = deps.now ?? Date.now
  const providers = new Map(deps.providers.map((provider) => [provider.kind, provider]))
  const runs = createStoreSync({
    providers: deps.providers,
    index: deps.index,
    now,
    sourcesSignature: async () =>
      JSON.stringify((await sourcesOf(deps.providers, deps.index)).sources),
    onSynced: (outcome) => {
      if (outcome.cardsChanged) deps.resyncMeaning?.()
    },
  })
  watchProviders(deps.providers, runs.invalidate)

  const providerOf = (kind: PackageKind): StoreProvider => {
    const provider = providers.get(kind)
    if (!provider)
      throw new NotFoundError('store_kind_unknown', `The Store has no ${kind} packages`)
    return provider
  }
  const unsupported = (kind: PackageKind, what: string) =>
    new ConflictError('store_unsupported', `${kind} packages cannot ${what}`)

  const searchProvider = createStoreSearchProvider({
    index: deps.index,
    ready: (userId) => runs.ready({ userId }),
    ...(deps.projectWords ? { projectWords: deps.projectWords } : {}),
    staticOf: (listing) => staticScore(listing, { now: now() }),
  })

  /** A search, through the global search service, in its order, a page at a time. */
  async function searched(actor: StoreActor, query: ListingQuery, filters: object, limit: number) {
    const answer = await deps.search(actor.userId, {
      text: query.q!,
      domains: [STORE_SEARCH_DOMAIN],
      limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      providerOptions: { filters },
    })
    const refs = answer.hits.flatMap((hit) => refOfStoreHit(hit) ?? [])
    const found = await deps.index.byRefs(actor.userId, refs)
    return {
      listings: refs.flatMap((ref) => found.get(refKey(ref)) ?? []),
      ...(answer.nextCursor ? { nextCursor: answer.nextCursor } : {}),
      strategy: answer.strategy,
    }
  }

  return {
    /** A change notice the Store did not hear from a provider (`bootstrap/` relays them). */
    invalidate: runs.invalidate,
    /** Hear every change to what the Store lists, once it is indexed; returns the unsubscribe. */
    subscribe: runs.subscribe,
    /** Hear every write to, or change of, the sources the Store reads from. */
    subscribeSources: runs.subscribeSources,
    /** Resolves when every sync started so far has been written. */
    settled: runs.settled,
    /** The `store` provider of the global search registry. */
    searchProvider,

    async listings(actor: StoreActor, query: ListingQuery): Promise<ListingsResponse> {
      await runs.ready(actor)
      const filters = {
        ...(query.shelf ? { shelf: query.shelf } : {}),
        ...(query.scope ? { scope: query.scope } : {}),
        ...(query.installed !== undefined ? { installed: query.installed } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.source ? { source: query.source } : {}),
        ...(query.trust ? { trust: query.trust } : {}),
      }
      const limit = query.limit ?? LISTINGS_PAGE
      // Asked beside the index reads, not before them: a slow project folder holds up nothing else.
      const asked = projectAuthored(deps.providers, {
        ...actor,
        ...(query.projectId ? { projectId: query.projectId } : {}),
      })
      if (query.shelf === 'project') {
        const authored = await asked
        return {
          listings: matching(authored, query.q),
          facets: withProjectCount(await deps.index.facets(actor.userId, {}), authored.length),
          problems: runs.problems(actor),
        }
      }
      const [page, facets] = await Promise.all([
        query.q?.trim()
          ? searched(actor, query, filters, limit)
          : deps.index.page(actor.userId, filters, {
              limit,
              ...(query.cursor ? { cursor: query.cursor } : {}),
              boost: [...((await deps.projectWords?.(actor.userId, query.projectId)) ?? [])],
            }),
        deps.index.facets(actor.userId, filters),
      ])
      const shown = query.projectId
        ? await withProjectInstalls(page, {
            providers: deps.providers,
            index: deps.index,
            userId: actor.userId,
            projectId: query.projectId,
            filters,
            first: !query.cursor && !query.q?.trim(),
          })
        : page
      return {
        ...shown,
        facets: withProjectCount(facets, (await asked).length),
        problems: runs.problems(actor),
      }
    },

    async detail(ref: ListingRef, actor: StoreActor) {
      await runs.ready(actor)
      const detail = await providerOf(ref.kind).detail(ref.id, actor)
      // What a fetched package contains is written back, so its card and shelves show it; a page
      // answered before its package was fetched has learned nothing yet.
      const learned =
        (detail.contents !== 'unknown' || detail.components.length > 0) &&
        (await deps.index.rememberComponents(ref, detail.components))
      if (learned && deps.resyncMeaning) deps.resyncMeaning()
      const indexed = await deps.index.get(actor.userId, ref)
      if (!indexed) return detail
      return {
        ...detail,
        ...(indexed.alsoIn?.length ? { alsoIn: indexed.alsoIn } : {}),
        ...(await relatedOf(deps.index, actor.userId, indexed)),
      }
    },

    /** What Discover shows (`discover.ts`). */
    async discover(actor: StoreActor, query: { projectId?: string }): Promise<DiscoverResponse> {
      await runs.ready(actor)
      return discoverOf({
        index: deps.index,
        providers: deps.providers,
        actor,
        projectWords: (await deps.projectWords?.(actor.userId, query.projectId)) ?? new Set(),
        now: now(),
      })
    },

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

    ...configService(providerOf),

    ...itemService(deps.providers, providerOf, runs.invalidate),

    /** Every source, with when it was last read and why not, and the kinds one can be added for. */
    sources: (): Promise<{ sources: SourceView[]; addable: PackageKind[] }> =>
      sourcesOf(deps.providers, deps.index),

    async refreshSource(kind: PackageKind, id: string) {
      const provider = providerOf(kind)
      if (!provider.refreshSource) throw unsupported(kind, 'read one source again')
      await provider.refreshSource(id)
      runs.announceSources()
      runs.invalidate()
    },

    async setSourceAutoUpdate(kind: PackageKind, id: string, on: boolean) {
      const provider = providerOf(kind)
      if (!provider.setSourceAutoUpdate) throw unsupported(kind, 'switch auto-update')
      await provider.setSourceAutoUpdate(id, on)
      runs.announceSources()
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
      runs.announceSources()
    },

    async removeSource(kind: PackageKind, id: string) {
      const provider = providerOf(kind)
      if (!provider.removeSource) throw unsupported(kind, 'remove a source')
      await provider.removeSource(id)
      runs.announceSources()
    },

    /** The jobs in flight and the updates offered, every kind's, from the index. */
    async activity(actor: StoreActor): Promise<StoreActivity> {
      await runs.ready(actor)
      return activityOf(await deps.index.stated(actor.userId))
    },

    /**
     * Every provider fetches its sources again (the six-hourly sync); what moved is indexed off
     * the request path. A provider that cannot is left as it was.
     */
    async refreshSources(): Promise<void> {
      await Promise.all(deps.providers.map((provider) => provider.refresh().catch(() => {})))
      runs.invalidate()
    },

    /**
     * Update all: every provider re-reads its sources, then each install a newer version is
     * offered for is updated, unless a job already runs for it. Returns what was queued.
     */
    async applyUpdates(actor: StoreActor): Promise<ListingRef[]> {
      await Promise.all(deps.providers.map((provider) => provider.refresh()))
      await runs.syncNow(actor)
      const queued: ListingRef[] = []
      for (const listing of await deps.index.stated(actor.userId)) {
        const scopes = listing.installs.filter((install) => install.updateTo)
        if (scopes.length === 0 || listing.incompatible || runs.busy(listing)) continue
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
