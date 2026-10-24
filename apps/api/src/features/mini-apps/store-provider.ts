import {
  packageKindSchema,
  type Editorial,
  type InstallPlan,
  type ListingRef,
  type Scope,
  type StoreActor,
  type StoreProvider,
} from '@localixai/store'

import { InvalidRequestError } from '../../lib/domain-errors'
import type { MiniAppCatalogPreview } from './catalog-preview'
import type { MiniAppCatalogRecord } from './catalogs'
import type { MiniAppStore } from './store'
import {
  catalogLabel,
  catalogTrust,
  miniAppComponents,
  miniAppDetail,
  miniAppListing,
} from './store-listing'

/** What the provider needs of the mini app service: its store, catalogs and the person's apps. */
export interface MiniAppStoreProviderDeps {
  store: Pick<MiniAppStore, 'list' | 'detail' | 'install' | 'refresh' | 'subscribe'>
  catalogs: {
    list(): Promise<MiniAppCatalogRecord[]>
    add(url: string): Promise<void>
    remove(url: string): Promise<void>
    preview(url: string): Promise<MiniAppCatalogPreview>
  }
  apps: {
    list(userId: string): Promise<{ miniApps: { name: string; enabled: boolean }[] }>
    setEnabled(userId: string, input: { name: string; enabled: boolean }): Promise<void>
    remove(userId: string, input: { name: string }): Promise<void>
  }
}

/** A pick's item: an app's name, or `<kind>:<id>` for another kind. */
function refOfPick(item: string): ListingRef | null {
  const at = item.indexOf(':')
  if (at < 0) return { kind: 'mini-app', id: item }
  const kind = packageKindSchema.safeParse(item.slice(0, at))
  return kind.success && at < item.length - 1 ? { kind: kind.data, id: item.slice(at + 1) } : null
}

/** A mini app belongs to the person: it has no project install (`docs/internals/store.md`). */
function personOnly(scope: Scope) {
  if (scope !== 'user')
    throw new InvalidRequestError(
      'mini_app_user_scope',
      'A mini app is installed for you, never for one project',
    )
}

/**
 * MINI APPS AS A STORE PROVIDER: the catalogs' offers, the installs and the catalog list served
 * through the Store's port. It adapts the store (`store.ts`), its pages (`store-detail.ts`) and
 * the catalogs (`catalogs.ts`), which keep their own routes for the pages that read them; the
 * refusals stay theirs (an unverified publisher without a yes, a name the person already uses).
 */
export function createMiniAppStoreProvider(deps: MiniAppStoreProviderDeps): StoreProvider {
  const labels = async () =>
    new Map(
      (await deps.catalogs.list()).map(({ url, builtIn }) => [
        url,
        { label: catalogLabel(url, builtIn), builtIn },
      ]),
    )

  const listingFor = async (name: string, actor: StoreActor) => {
    const [page, label, enabled] = await Promise.all([
      deps.store.detail(name),
      labels(),
      deps.apps.list(actor.userId),
    ])
    const on = enabled.miniApps.find((app) => app.name === name)?.enabled ?? true
    const catalog = label.get(page.entry.source)
    const listing = miniAppListing(page.entry, {
      sourceLabel: catalog?.label ?? page.entry.source,
      builtIn: catalog?.builtIn ?? false,
      enabled: on,
    })
    return { page, listing }
  }

  return {
    kind: 'mini-app',

    async listings(actor) {
      const [{ entries, problems }, label, apps] = await Promise.all([
        deps.store.list(),
        labels(),
        deps.apps.list(actor.userId),
      ])
      const enabled = new Map(apps.miniApps.map((app) => [app.name, app.enabled]))
      return {
        listings: entries.map((entry) =>
          miniAppListing(entry, {
            sourceLabel: label.get(entry.source)?.label ?? entry.source,
            builtIn: label.get(entry.source)?.builtIn ?? false,
            enabled: enabled.get(entry.name) ?? true,
          }),
        ),
        problems,
      }
    },

    async detail(id, actor) {
      const { page, listing } = await listingFor(id, actor)
      return miniAppDetail(listing, page)
    },

    async plan(id, scope, actor): Promise<InstallPlan> {
      personOnly(scope)
      const { page, listing } = await listingFor(id, actor)
      const unverified = !listing.publisher.verified && listing.installs.length === 0
      return {
        scope,
        adds: miniAppComponents(page.entry),
        runs: listing.runsCode ? [{ kind: 'backend', name: listing.displayName }] : [],
        network: [],
        requires: [],
        warnings: [
          ...(unverified ? [`${listing.publisher.name} is not a publisher Localix verifies`] : []),
          ...(listing.incompatible ? [listing.incompatible] : []),
        ],
        needsConsent: unverified,
      }
    },

    async install(id, scope, consent, actor) {
      personOnly(scope)
      await deps.store.install(id, { userId: actor.userId, acceptUnverified: consent.plan })
    },

    // An update replaces a copy the person already chose to run: no second yes.
    async update(id, scope, actor) {
      personOnly(scope)
      await deps.store.install(id, { userId: actor.userId, acceptUnverified: true })
    },

    async remove(id, scope, actor) {
      personOnly(scope)
      await deps.apps.remove(actor.userId, { name: id })
    },

    async setEnabled(id, scope, enabled, actor) {
      personOnly(scope)
      await deps.apps.setEnabled(actor.userId, { name: id, enabled })
    },

    refresh: () => deps.store.refresh(),

    async sources() {
      const [catalogs, { entries, failed }] = await Promise.all([
        deps.catalogs.list(),
        deps.store.list(),
      ])
      return catalogs.map(({ url, builtIn }) => ({
        kind: 'mini-app' as const,
        id: url,
        label: catalogLabel(url, builtIn),
        url,
        builtIn,
        count: entries.filter((entry) => entry.source === url).length,
        trust: catalogTrust(builtIn).trust,
        // Localix's own catalog is the one a fresh profile starts with.
        ...(builtIn ? { defaultSource: true } : {}),
        ...(failed?.[url] ? { problem: failed[url] } : {}),
      }))
    },

    /** The catalogs are read together: reading one again reads them all. */
    refreshSource: () => deps.store.refresh(),

    async previewSource(input) {
      const preview = await deps.catalogs.preview(input)
      return {
        kind: 'mini-app',
        id: preview.url,
        label: catalogLabel(preview.url, false),
        publishers: preview.publishers,
        count: preview.apps,
        icons: preview.icons,
        verified: preview.verified,
        added: preview.added,
      }
    },

    /**
     * What the catalogs Localix vouches for pick for Discover. An item is an app's name, or
     * `<kind>:<id>` for another kind; a hero without its own picture shows its first screenshot.
     */
    async editorial(): Promise<Editorial[]> {
      const [{ editorial }, label] = await Promise.all([deps.store.list(), labels()])
      const picks = editorial.filter(
        ({ source }) => catalogTrust(label.get(source)?.builtIn ?? false).editorial,
      )
      return Promise.all(
        picks.map(async ({ source, editorial: pick }) => {
          const hero = pick.hero ? refOfPick(pick.hero.item) : null
          const image =
            pick.hero?.image ??
            (hero?.kind === 'mini-app'
              ? (await deps.store.detail(hero.id).catch(() => null))?.screenshots[0]?.url
              : undefined)
          return {
            source,
            ...(pick.hero && hero
              ? {
                  hero: {
                    item: hero,
                    ...(pick.hero.title ? { title: pick.hero.title } : {}),
                    ...(pick.hero.subtitle ? { subtitle: pick.hero.subtitle } : {}),
                    ...(image ? { image } : {}),
                  },
                }
              : {}),
            collections: pick.collections.map((collection) => ({
              id: collection.id,
              title: collection.title,
              ...(collection.subtitle ? { subtitle: collection.subtitle } : {}),
              style: collection.style,
              items: collection.items.flatMap((item) => refOfPick(item) ?? []),
            })),
          }
        }),
      )
    },

    addSource: (input) => deps.catalogs.add(input),
    removeSource: (id) => deps.catalogs.remove(id),
    subscribe: (onChange) => deps.store.subscribe(onChange),
  }
}
