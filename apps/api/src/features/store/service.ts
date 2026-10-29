import {
  LISTINGS_PAGE,
  type DiscoverResponse,
  type ListingRef,
  type ListingsResponse,
  type PackageKind,
  type Scope,
  type SourceView,
  type StoreActivity,
  type StoreActor,
  type StoreProvider,
} from '@localixai/store'

import { NotFoundError } from '../../lib/domain-errors'
import { activityOf } from './activity'
import { configService } from './config'
import { itemService } from './items'
import { discoverOf, relatedOf } from './discover'
import { recommendationService } from './service-recommend'
import type { StoreIndexRepository } from './index-repository'
import { refKey } from './index-rows'
import { pageProblems } from './page-problems'
import { matching, projectAuthored, withProjectCount } from './project-authored'
import { withProjectInstalls } from './project-installs'
import type { ProjectFacts } from './project-signals'
import { staticScore } from './ranking'
import { unsupported } from './unsupported'
import { createStoreSearchProvider, refOfStoreHit, STORE_SEARCH_DOMAIN } from './search-provider'
import { sourcesOf } from './sources'
import { createStoreSync, watchProviders } from './store-runs'

export type {
  ListingQuery,
  StoreContextPort,
  StoreDismissalsPort,
  StoreItemMeaningPort,
  StoreRecommendationEventsPort,
  StoreSearchPort,
} from './service-types'
import type {
  ListingQuery,
  StoreContextPort,
  StoreDismissalsPort,
  StoreItemMeaningPort,
  StoreRecommendationEventsPort,
  StoreSearchPort,
} from './service-types'
import { applyUpdates, sourceActions } from './service-updates'

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
  /** These listings' cards changed: the semantic collection reads them alone again. */
  meaningChanged?: (keys: string[]) => void
  /** The open project's words, for the boost (`project-signals.ts`). */
  projectWords?: (userId: string, projectId: string | null | undefined) => Promise<Set<string>>
  /** The open project's root names and dependencies, as written (`recommend-rules.ts`). */
  projectFacts?: (userId: string, projectId: string | null | undefined) => Promise<ProjectFacts>
  /** What the working set says, admitted for `recommendation` (`recommend.ts`). */
  workingContext?: StoreContextPort
  /** What the person turned down for recommendations (`dismissals-repository.ts`). */
  dismissals?: StoreDismissalsPort
  /** What happened to recommendations (`recommendation-events-repository.ts`). */
  recommendationEvents?: StoreRecommendationEventsPort
  /** What installed packages are near in the semantic collection (`recommend-candidates.ts`). */
  similarToItems?: StoreItemMeaningPort
  /** When background recommendations run (`recommend-board.ts`); tests run them by hand. */
  scheduleRecommendation?: (work: () => void) => () => void
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

  const recommendations = recommendationService({
    index: deps.index,
    search: deps.search,
    ...(deps.workingContext ? { context: deps.workingContext } : {}),
    ...(deps.projectWords ? { projectWords: deps.projectWords } : {}),
    ...(deps.projectFacts ? { projectFacts: deps.projectFacts } : {}),
    ...(deps.dismissals ? { dismissals: deps.dismissals } : {}),
    ...(deps.recommendationEvents ? { events: deps.recommendationEvents } : {}),
    ...(deps.similarToItems ? { similarToItems: deps.similarToItems } : {}),
    staticOf: (listing) => staticScore(listing, { now: now() }),
    now,
    ready: runs.ready,
    ...(deps.scheduleRecommendation ? { schedule: deps.scheduleRecommendation } : {}),
  })
  // What the Store lists moved (an install, a sync): every remembered working set again.
  runs.subscribe(() => recommendations.board.refresh())

  const providerOf = (kind: PackageKind): StoreProvider => {
    const provider = providers.get(kind)
    if (!provider)
      throw new NotFoundError('store_kind_unknown', `The Store has no ${kind} packages`)
    return provider
  }

  const update = async (ref: ListingRef, scope: Scope, actor: StoreActor) => {
    const provider = providerOf(ref.kind)
    if (!provider.update) throw unsupported(ref.kind, 'be updated')
    await provider.update(ref.id, scope, actor)
  }

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
          problems: pageProblems(runs.problems(actor), query),
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
        problems: pageProblems(runs.problems(actor), query),
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
      if (learned) deps.meaningChanged?.([refKey(ref)])
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

    ...recommendations.service,

    async plan(ref: ListingRef, scope: Scope, actor: StoreActor) {
      const provider = providerOf(ref.kind)
      if (!provider.plan) throw unsupported(ref.kind, 'be installed')
      return provider.plan(ref.id, scope, actor)
    },

    async install(ref: ListingRef, scope: Scope, consent: { plan: boolean }, actor: StoreActor) {
      const provider = providerOf(ref.kind)
      if (!provider.install) throw unsupported(ref.kind, 'be installed')
      await provider.install(ref.id, scope, consent, actor)
      await recommendations.installed(actor, ref)
    },

    update,

    async remove(ref: ListingRef, scope: Scope, actor: StoreActor) {
      await providerOf(ref.kind).remove(ref.id, scope, actor)
      await recommendations.removed(actor, ref)
    },

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

    ...sourceActions(providerOf, runs),

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
      await Promise.all(
        deps.providers.map(async (provider) => provider.refresh?.().catch(() => {})),
      )
      runs.invalidate()
    },

    /** Update all (`service-updates.ts`): returns what was queued. */
    applyUpdates: (actor: StoreActor): Promise<ListingRef[]> =>
      applyUpdates({ providers: deps.providers, index: deps.index, runs, update }, actor),
  }
}

export type StoreService = ReturnType<typeof createStoreService>
