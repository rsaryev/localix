import type { MiniAppConfigField } from './contracts'
import type { MiniAppMarketplaceSource } from './marketplaces'
import type { MiniAppStoreEntry } from './store-entry'
import { miniAppListing, ownMiniAppEntry, type OwnMiniApp } from './store-listing'

/** An offer as installed here: the installed build its marketplace took back says so. */
export const revokedAs = (entry: MiniAppStoreEntry, app: { revoked?: string } | undefined) =>
  app?.revoked ? { ...entry, revoked: app.revoked } : entry

// One the person made is on their Yours shelf beside the skills and agents they wrote; one a
// marketplace installed and no longer offers stays its marketplace's.
export const ownListing = (
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
export const ownPage = (app: OwnMiniApp) => ({
  entry: ownMiniAppEntry(app),
  readme: null,
  screenshots: [],
  details: {
    ...(app.version ? { version: app.version } : {}),
    author: app.installedFrom?.publisher.name ?? 'You',
    ...(app.homepage ? { homepage: app.homepage } : {}),
  },
})
