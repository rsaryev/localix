import type {
  Editorial,
  InstallPlan,
  Listing,
  ListingDetail,
  PackageKind,
  Scope,
  SourcePreview,
  SourceView,
  StoreInstall,
} from './contract'

/**
 * Who a call is for. Enabled state and the yes to run a package are the person's, so every call
 * names them; the Store passes it through and keeps nothing per person.
 */
export interface StoreActor {
  userId: string
  /** The open project: where a `project` install goes, and whose installs a listing shows. */
  projectId?: string | null
}

/** What a listing page shows beside the listings: sources that could not be read this time. */
export interface ProviderListings {
  listings: Listing[]
  problems: string[]
}

/**
 * The port one feature implements to serve its package kind through the Store
 * (`docs/internals/store.md`, "Provider port"). It owns its records, sources, routes and errors:
 * a method throws the provider's own domain errors, and only the Store's routes turn them into
 * HTTP. A capability a provider lacks is an absent method; the UI hides its control.
 */
export interface StoreProvider {
  kind: PackageKind
  /** From the provider's cached feeds. */
  listings(actor: StoreActor): Promise<ProviderListings>
  detail(id: string, actor: StoreActor): Promise<ListingDetail>
  /** May fetch a remote package into the provider's cache. */
  plan(id: string, scope: Scope, actor: StoreActor): Promise<InstallPlan>
  /** Queues a job; resolves once queued. Refuses a plan that needs consent without it. */
  install(id: string, scope: Scope, consent: { plan: boolean }, actor: StoreActor): Promise<void>
  update(id: string, scope: Scope, actor: StoreActor): Promise<void>
  remove(id: string, scope: Scope, actor: StoreActor): Promise<void>
  setEnabled?(id: string, scope: Scope, enabled: boolean, actor: StoreActor): Promise<void>
  /** Re-read the sources, so the next listings are fresh. */
  refresh(): Promise<void>
  sources(): Promise<SourceView[]>
  previewSource?(input: string): Promise<SourcePreview>
  addSource?(input: string): Promise<void>
  removeSource?(id: string): Promise<void>
  /** Read one source again now. */
  refreshSource?(id: string): Promise<void>
  /** Whether one source is read again, and what it installed updated, on its own. */
  setSourceAutoUpdate?(id: string, on: boolean): Promise<void>
  /**
   * The open project's own installs (`actor.projectId`), by listing id: what a listing shows on
   * top of the person's. Cheap: no listing is built. Absent for a kind with no project scope.
   */
  projectInstalls?(
    actor: StoreActor & { projectId: string },
  ): Promise<Array<{ id: string; installs: StoreInstall[] }>>
  /** The hero and collections its editorial sources pick for Discover; none when it has none. */
  editorial?(): Promise<Editorial[]>
  /** Hear every change to what `listings` would answer; returns the unsubscribe. */
  subscribe(onChange: () => void): () => void
}
