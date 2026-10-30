import {
  listingConfigFromFields,
  scalarConfigValues,
  type Editorial,
  type InstallPlan,
  type Scope,
  type StoreActor,
  type InstallableProvider,
  opensFile,
} from '@localixai/store'

import { InvalidRequestError } from '../../lib/domain-errors'
import type { MiniAppCatalogPreview } from './catalog-preview'
import type { MiniAppCatalogRecord } from './catalogs'
import type { MiniAppConfigField } from './contracts'
import type { MiniAppStore } from './store'
import {
  catalogLabel,
  catalogTrust,
  miniAppComponents,
  miniAppDetail,
  miniAppListing,
  OWN_SOURCE,
  ownMiniAppEntry,
  refOfPick,
  type OwnMiniApp,
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
    list(userId: string): Promise<{
      miniApps: (OwnMiniApp & { enabled: boolean; config: MiniAppConfigField[] })[]
    }>
    setConfig(
      userId: string,
      input: { name: string; values: Record<string, string | number | boolean> },
    ): Promise<void>
    setEnabled(userId: string, input: { name: string; enabled: boolean }): Promise<void>
    remove(userId: string, input: { name: string }): Promise<void>
  }
  /** Which installed apps the person keeps from updating on their own (`auto-update.ts`). */
  autoUpdate: {
    off(): Promise<ReadonlySet<string>>
    set(name: string, on: boolean): Promise<void>
  }
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
export function createMiniAppStoreProvider(deps: MiniAppStoreProviderDeps): InstallableProvider {
  const labels = async () =>
    new Map(
      (await deps.catalogs.list()).map(({ url, builtIn, sourceId }) => [
        url,
        { label: catalogLabel(url, builtIn, sourceId), builtIn, sourceId },
      ]),
    )

  const listingFor = async (name: string, actor: StoreActor) => {
    const [page, label, enabled, off] = await Promise.all([
      deps.store.detail(name),
      labels(),
      deps.apps.list(actor.userId),
      deps.autoUpdate.off(),
    ])
    const app = enabled.miniApps.find((found) => found.name === name)
    const catalog = label.get(page.entry.source)
    const listing = miniAppListing(page.entry, {
      sourceLabel: catalog?.label ?? page.entry.source,
      builtIn: catalog?.builtIn ?? false,
      sourceId: catalog?.sourceId,
      enabled: app?.enabled ?? true,
      configurable: (app?.config.length ?? 0) > 0,
      autoUpdateOff: off.has(name),
    })
    return { page, listing }
  }

  // The person made it, so it is on their Yours shelf beside the skills and agents they wrote.
  const ownListing = (app: OwnMiniApp & { enabled: boolean; config: MiniAppConfigField[] }) => ({
    ...miniAppListing(ownMiniAppEntry(app), {
      sourceLabel: OWN_SOURCE.label,
      builtIn: false,
      enabled: app.enabled,
      configurable: app.config.length > 0,
    }),
    authored: 'user' as const,
  })
  const ownPage = (app: OwnMiniApp) => ({
    entry: ownMiniAppEntry(app),
    readme: null,
    screenshots: [],
    details: {
      ...(app.version ? { version: app.version } : {}),
      author: 'You',
      ...(app.homepage ? { homepage: app.homepage } : {}),
    },
  })

  // The offers and the person's own apps, as listings: `listings` and what opens a file.
  const listings = async (actor: StoreActor) => {
    const [{ entries, problems }, label, apps, off] = await Promise.all([
      deps.store.list(),
      labels(),
      deps.apps.list(actor.userId),
      deps.autoUpdate.off(),
    ])
    const installed = new Map(apps.miniApps.map((app) => [app.name, app]))
    const offered = new Set(entries.map((entry) => entry.name))
    const own = apps.miniApps.filter((app) => !offered.has(app.name))
    return {
      listings: [
        ...entries.map((entry) =>
          miniAppListing(entry, {
            sourceLabel: label.get(entry.source)?.label ?? entry.source,
            builtIn: label.get(entry.source)?.builtIn ?? false,
            sourceId: label.get(entry.source)?.sourceId,
            enabled: installed.get(entry.name)?.enabled ?? true,
            configurable: (installed.get(entry.name)?.config.length ?? 0) > 0,
            autoUpdateOff: off.has(entry.name),
          }),
        ),
        ...own.map((app) => ownListing(app)),
      ],
      problems,
    }
  }

  return {
    kind: 'mini-app',

    listings,

    async openers(path, actor) {
      const opening = (await listings(actor)).listings.filter(
        (listing) => listing.opens && opensFile(listing.opens, path) && !listing.incompatible,
      )
      // What Localix vouches for first; a stranger's claim after it.
      return opening.sort((a, b) => Number(b.publisher.verified) - Number(a.publisher.verified))
    },

    async detail(id, actor) {
      const offered = await listingFor(id, actor).catch(async (error: unknown) => {
        const app = (await deps.apps.list(actor.userId)).miniApps.find((it) => it.name === id)
        if (!app) throw error
        return { listing: ownListing(app), page: ownPage(app) }
      })
      return miniAppDetail(offered.listing, offered.page)
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

    // An app is installed for the whole computer, so the switch is too.
    async setAutoUpdate(id, on) {
      await deps.autoUpdate.set(id, on)
    },

    /** The settings its manifest declares; a mini app is the person's, so only `user` has them. */
    async config(id, scope, actor) {
      if (scope !== 'user') return null
      const app = (await deps.apps.list(actor.userId)).miniApps.find((found) => found.name === id)
      return app && app.config.length > 0
        ? listingConfigFromFields(app.config, { scope: 'user', scopes: ['user'] })
        : null
    },

    async setConfig(id, scope, values, actor) {
      personOnly(scope)
      await deps.apps.setConfig(actor.userId, { name: id, values: scalarConfigValues(values) })
    },

    refresh: () => deps.store.refresh(),

    async sources() {
      const [catalogs, { entries, failed }] = await Promise.all([
        deps.catalogs.list(),
        deps.store.list(),
      ])
      return catalogs.map(({ url, builtIn, sourceId }) => ({
        kind: 'mini-app' as const,
        id: url,
        label: catalogLabel(url, builtIn, sourceId),
        url,
        builtIn,
        count: entries.filter((entry) => entry.source === url).length,
        trust: catalogTrust(builtIn, sourceId).trust,
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
     * `<kind>:<id>` for another kind.
     */
    async editorial(): Promise<Editorial[]> {
      const [{ editorial }, label] = await Promise.all([deps.store.list(), labels()])
      const picks = editorial.filter(
        ({ source }) =>
          catalogTrust(label.get(source)?.builtIn ?? false, label.get(source)?.sourceId).editorial,
      )
      return picks.map(({ source, editorial: pick }) => ({
        source,
        collections: pick.collections.map((collection) => ({
          id: collection.id,
          title: collection.title,
          ...(collection.subtitle ? { subtitle: collection.subtitle } : {}),
          style: collection.style,
          items: collection.items.flatMap((item) => refOfPick(item) ?? []),
        })),
      }))
    },

    addSource: (input) => deps.catalogs.add(input),
    removeSource: (id) => deps.catalogs.remove(id),
    subscribe: (onChange) => deps.store.subscribe(onChange),
  }
}
