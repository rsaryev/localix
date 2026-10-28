import { createContext, useContext } from 'react'
import type { Listing, ListingRef, Scope, StoreComponent, StoreInstall } from '@localixai/store'
import type { StoreClient } from '@/shared/api/store-client'
import type { StoreInstallExtra } from '@/shared/lib/storeInstallExtra'
import type { StoreSection, StoreView } from './navigation'

/** The project open beside the Store: a plugin can be installed for it alone. */
export interface StoreProject {
  id: string
  name: string
}

/**
 * What every part of the Store reaches without being handed it: the client, the open project,
 * where to go and what to do to a listing. One value per Store, made by `StoreView`.
 */
export interface StoreScope {
  client: StoreClient
  project: StoreProject | null
  /** The chat open beside the Store, whose workspace the open tabs are read in. */
  sessionId: string | null
  /** Open a listing's page, marked at one of its components. */
  open: (listing: Listing | ListingRef, focus?: Pick<StoreComponent, 'kind' | 'name'>) => void
  /** Open an installed listing's page on its Settings tab. */
  configure: (listing: Listing) => void
  /** Show a full list over the current section. */
  show: (view: StoreView) => void
  /** Go to a section of the sidebar. */
  goTo: (section: StoreSection) => void
  /** Update every install a newer version is offered for. */
  updateAll: () => void
  /** Do a write; a failure is said once, above the content. */
  run: (write: Promise<unknown>) => void
  /** Start reading a listing's page: the pointer rests on its card. */
  prefetch: (ref: ListingRef) => void
  /** The Get button was pressed: install (asking first when it must), update, retry or open. */
  get: (listing: Listing, options?: { scope?: Scope; extra?: StoreInstallExtra }) => void
  update: (listing: Listing, install?: StoreInstall) => void
  remove: (listing: Listing, install?: StoreInstall) => void
  setEnabled: (listing: Listing, install: StoreInstall, enabled: boolean) => void
  /** Open a `localix://` address: an installed package, a provider's settings for it. */
  navigate: (uri: string) => void
  /** The install extras this listing can have here ("Install as app"). */
  extrasFor: (listing: Listing) => readonly StoreInstallExtra[]
  /** Make or remove an extra for an installed listing. */
  makeExtra: (extra: StoreInstallExtra, listing: Listing) => void
  removeExtra: (extra: StoreInstallExtra, listing: Listing) => void
  /** Why an extra was not made, by listing key. */
  extraProblems: Record<string, string>
}

export const StoreScopeContext = createContext<StoreScope | null>(null)

export function useStoreScope(): StoreScope {
  const scope = useContext(StoreScopeContext)
  if (!scope) throw new Error('A Store part was drawn outside the Store')
  return scope
}
