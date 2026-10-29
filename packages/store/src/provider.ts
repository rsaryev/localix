import type {
  ActionResult,
  ConfigValue,
  CreateForm,
  ItemAction,
  ListingConfig,
  ShelfPlan,
} from './config'
import type {
  Editorial,
  InstallPlan,
  Listing,
  ListingDetail,
  ListingRef,
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
  /**
   * May fetch a remote package into the provider's cache. `plan`, `install` and `update` are absent
   * for a kind the person makes here rather than installs (an agent, a skill, an MCP server).
   */
  plan?(id: string, scope: Scope, actor: StoreActor): Promise<InstallPlan>
  /** Queues a job; resolves once queued. Refuses a plan that needs consent without it. */
  install?(id: string, scope: Scope, consent: { plan: boolean }, actor: StoreActor): Promise<void>
  update?(id: string, scope: Scope, actor: StoreActor): Promise<void>
  remove(id: string, scope: Scope, actor: StoreActor): Promise<void>
  setEnabled?(id: string, scope: Scope, enabled: boolean, actor: StoreActor): Promise<void>
  /**
   * The settings of one install: what its package declares and what the person set. Null where
   * the package has none or is not installed in that scope. The provider keeps the storage.
   */
  config?(id: string, scope: Scope, actor: StoreActor): Promise<ListingConfig | null>
  /** Saves the given keys of one install's settings; a secret left out keeps its value. */
  setConfig?(
    id: string,
    scope: Scope,
    values: Record<string, ConfigValue>,
    actor: StoreActor,
  ): Promise<void>
  /** The form for a new item the person writes here (an MCP server, a skill); absent: none. */
  createFields?(actor: StoreActor): Promise<CreateForm>
  /** Makes one from the form's values and says what to open. */
  create?(scope: Scope, values: Record<string, ConfigValue>, actor: StoreActor): Promise<ListingRef>
  /** Does one of the install's `actions` (Test connection, Sign in) and says what happened. */
  runAction?(id: string, scope: Scope, action: string, actor: StoreActor): Promise<ActionResult>
  /**
   * What can be done to a whole shelf of its own items in one go ("Archive unused"): `user` is
   * Yours, `project` the open project's shelf. Absent or empty: the shelf shows no button.
   */
  shelfActions?(scope: Scope, actor: StoreActor): Promise<ItemAction[]>
  /** What one shelf action would change, computed and written nowhere: the preview to confirm. */
  planShelfAction?(action: string, scope: Scope, actor: StoreActor): Promise<ShelfPlan>
  /**
   * Does the action to the items the person confirmed (`ids`, from the plan). An item that no
   * longer qualifies is left alone: the plan is a preview, not a promise.
   */
  runShelfAction?(
    action: string,
    scope: Scope,
    ids: string[],
    actor: StoreActor,
  ): Promise<ActionResult>
  /** Re-read the sources, so the next listings are fresh. Absent for a kind with no sources. */
  refresh?(): Promise<void>
  sources?(): Promise<SourceView[]>
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
  /**
   * What the open project keeps in its own folder (`actor.projectId`), as listings the Project
   * shelf shows. Never returned by `listings`, which is the person's and indexed: a project's
   * files belong to that project alone. Absent for a kind that keeps nothing per project.
   */
  projectListings?(actor: StoreActor & { projectId: string }): Promise<Listing[]>
  /**
   * Its packages that open a file like `path` (`opensFile`), installed or not, best first: what a
   * file tab offers when nothing on this machine opens it. Absent for a kind that opens no files.
   */
  openers?(path: string, actor: StoreActor): Promise<Listing[]>
  /** The collections its editorial sources pick for Discover; none when it has none. */
  editorial?(): Promise<Editorial[]>
  /** Hear every change to what `listings` would answer; returns the unsubscribe. */
  subscribe(onChange: () => void): () => void
}

/** A provider whose packages are installed from sources: every install-side method is there. */
export type InstallableProvider = StoreProvider &
  Required<Pick<StoreProvider, 'plan' | 'install' | 'update' | 'refresh' | 'sources'>>
