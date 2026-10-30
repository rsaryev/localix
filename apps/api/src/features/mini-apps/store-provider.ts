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
import type { MiniAppConfigField } from './contracts'
import type { MiniAppStoreEntry } from './store-entry'
import type { MarketplacePreview } from './marketplace-preview'
import type { MiniAppMarketplaceSource } from './marketplaces'
import { appNameOf, type MiniAppStore } from './store'
import {
  marketplaceLabel,
  marketplaceTrust,
  miniAppComponents,
  miniAppDetail,
  miniAppListing,
  ownMiniAppEntry,
  type OwnMiniApp,
} from './store-listing'

/** What the provider needs of the mini app service: its store, marketplaces and the person's apps. */
export interface MiniAppStoreProviderDeps {
  store: Pick<MiniAppStore, 'list' | 'detail' | 'install' | 'refresh' | 'subscribe'>
  marketplaces: {
    list(): Promise<MiniAppMarketplaceSource[]>
    add(raw: string): Promise<unknown>
    remove(raw: string): Promise<void>
    preview(raw: string): Promise<MarketplacePreview>
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
 * MINI APPS AS A STORE PROVIDER: the marketplaces' offers, the installs and the marketplace list
 * served through the Store's port. It adapts the store (`store.ts`), its pages (`store-detail.ts`)
 * and the marketplaces (`marketplaces.ts`), which keep their own routes for the pages that read
 * them; the refusals stay theirs (an unverified publisher without a yes, a name another app
 * holds). An offered app's id is its identity, `<name>@<marketplace>`; an app the person made is
 * its name. Installing, removing and switching act on the app by its name, its folder.
 */
/** An offer as installed here: the installed build its marketplace took back says so. */
const revokedAs = (entry: MiniAppStoreEntry, app: { revoked?: string } | undefined) =>
  app?.revoked ? { ...entry, revoked: app.revoked } : entry

export function createMiniAppStoreProvider(deps: MiniAppStoreProviderDeps): InstallableProvider {
  const byUrl = async () => new Map((await deps.marketplaces.list()).map((it) => [it.url, it]))

  const listingFor = async (id: string, actor: StoreActor) => {
    const [page, marketplaces, enabled, off] = await Promise.all([
      deps.store.detail(id),
      byUrl(),
      deps.apps.list(actor.userId),
      deps.autoUpdate.off(),
    ])
    const { entry } = page
    const app = entry.installed && enabled.miniApps.find((found) => found.name === entry.name)
    const listing = miniAppListing(revokedAs(entry, app || undefined), {
      marketplace: marketplaces.get(entry.source) ?? {
        name: entry.marketplace ?? '',
        builtIn: false,
      },
      enabled: app ? app.enabled : true,
      configurable: app ? app.config.length > 0 : false,
      autoUpdateOff: off.has(entry.name),
    })
    return { page, listing }
  }

  // One the person made is on their Yours shelf beside the skills and agents they wrote; one a
  // marketplace installed and no longer offers stays its marketplace's.
  const ownListing = (
    app: OwnMiniApp & { enabled: boolean; config: MiniAppConfigField[] },
    known: Map<string, MiniAppMarketplaceSource>,
  ) => {
    const from = app.installedFrom?.marketplace
    const marketplace =
      from && ([...known.values()].find((it) => it.name === from) ?? { name: from, builtIn: false })
    return {
      ...miniAppListing(ownMiniAppEntry(app), {
        ...(marketplace ? { marketplace } : {}),
        enabled: app.enabled,
        configurable: app.config.length > 0,
      }),
      ...(from ? {} : { authored: 'user' as const }),
    }
  }
  const ownPage = (app: OwnMiniApp) => ({
    entry: ownMiniAppEntry(app),
    readme: null,
    screenshots: [],
    details: {
      ...(app.version ? { version: app.version } : {}),
      author: app.installedFrom?.publisher.name ?? 'You',
      ...(app.homepage ? { homepage: app.homepage } : {}),
    },
  })

  // The offers and the person's own apps, as listings: `listings` and what opens a file.
  const listings = async (actor: StoreActor) => {
    const [{ entries, problems }, marketplaces, apps, off] = await Promise.all([
      deps.store.list(),
      byUrl(),
      deps.apps.list(actor.userId),
      deps.autoUpdate.off(),
    ])
    const installed = new Map(apps.miniApps.map((app) => [app.name, app]))
    // An installed app no marketplace offers as itself is listed as it is on this computer.
    const offered = new Set(entries.flatMap((entry) => (entry.installed ? [entry.name] : [])))
    const own = apps.miniApps.filter((app) => !offered.has(app.name))
    return {
      listings: [
        ...entries.map((entry) => {
          const app = entry.installed ? installed.get(entry.name) : undefined
          return miniAppListing(revokedAs(entry, app), {
            marketplace: marketplaces.get(entry.source) ?? {
              name: entry.marketplace ?? '',
              builtIn: false,
            },
            enabled: app?.enabled ?? true,
            configurable: (app?.config.length ?? 0) > 0,
            autoUpdateOff: off.has(entry.name),
          })
        }),
        ...own.map((app) => ownListing(app, marketplaces)),
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
        const name = appNameOf(id)
        const app = (await deps.apps.list(actor.userId)).miniApps.find((it) => it.name === name)
        if (!app) throw error
        return { listing: ownListing(app, await byUrl()), page: ownPage(app) }
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
      await deps.apps.remove(actor.userId, { name: appNameOf(id) })
    },

    async setEnabled(id, scope, enabled, actor) {
      personOnly(scope)
      await deps.apps.setEnabled(actor.userId, { name: appNameOf(id), enabled })
    },

    // An app is installed for the whole computer, so the switch is too.
    async setAutoUpdate(id, on) {
      await deps.autoUpdate.set(appNameOf(id), on)
    },

    /** The settings its manifest declares; a mini app is the person's, so only `user` has them. */
    async config(id, scope, actor) {
      if (scope !== 'user') return null
      const name = appNameOf(id)
      const app = (await deps.apps.list(actor.userId)).miniApps.find((found) => found.name === name)
      return app && app.config.length > 0
        ? listingConfigFromFields(app.config, { scope: 'user', scopes: ['user'] })
        : null
    },

    async setConfig(id, scope, values, actor) {
      personOnly(scope)
      await deps.apps.setConfig(actor.userId, {
        name: appNameOf(id),
        values: scalarConfigValues(values),
      })
    },

    refresh: () => deps.store.refresh(),

    async sources() {
      const [marketplaces, { entries, failed }] = await Promise.all([
        deps.marketplaces.list(),
        deps.store.list(),
      ])
      return marketplaces.map((marketplace) => ({
        kind: 'mini-app' as const,
        id: marketplace.url,
        label: marketplaceLabel(marketplace),
        url: marketplace.url,
        builtIn: marketplace.builtIn,
        count: entries.filter((entry) => entry.source === marketplace.url).length,
        trust: marketplaceTrust(marketplace).trust,
        // Localix's own marketplace is the one a fresh profile starts with.
        ...(marketplace.builtIn ? { defaultSource: true } : {}),
        ...(failed[marketplace.url] ? { problem: failed[marketplace.url] } : {}),
      }))
    },

    /** The marketplaces are read together: reading one again reads them all. */
    refreshSource: () => deps.store.refresh(),

    async previewSource(input) {
      const preview = await deps.marketplaces.preview(input)
      return {
        kind: 'mini-app',
        id: preview.url,
        label: preview.name,
        publishers: preview.publishers,
        count: preview.apps,
        icons: preview.icons,
        verified: preview.verified,
        added: preview.added,
      }
    },

    /** Discover's rows, from the marketplaces Localix vouches for (`store-offers.ts`). */
    async editorial(): Promise<Editorial[]> {
      return (await deps.store.list()).editorial
    },

    addSource: async (input) => {
      await deps.marketplaces.add(input)
    },
    removeSource: (id) => deps.marketplaces.remove(id),
    subscribe: (onChange) => deps.store.subscribe(onChange),
  }
}
