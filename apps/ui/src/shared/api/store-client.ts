import type {
  ActionResult,
  ConfigValue,
  CreateForm,
  DiscoverResponse,
  InstallPlan,
  ListingConfig,
  ListingDetail,
  ListingRef,
  ListingsResponse,
  PackageKind,
  Scope,
  SourcePreview,
  SourcesResponse,
  StoreActivity,
  StoreCategory,
  Trust,
} from '@localixai/store'
import { assertOk, cleanQuery, client, unwrap } from './internal'

const listing = () => client.rpc.store[':kind'][':id']
const param = (ref: ListingRef) => ({ param: { kind: ref.kind, id: ref.id } })
/** The open project, when there is one: where a `project` install goes. */
const project = (projectId?: string | null) => (projectId ? { projectId } : {})

/** What one page of listings is narrowed by, and where it starts. */
export interface StorePageQuery {
  shelf?: string
  q?: string
  category?: StoreCategory
  /** A source's id. */
  source?: string
  trust?: Trust
  installed?: boolean
  /** The open project: lifts what suits it and shows its installs. */
  projectId?: string | null
  /** Where the previous page ended (`nextCursor`). */
  cursor?: string
  limit?: number
}

/**
 * The Store (`/rpc/store`, `docs/internals/store.md`): listings a page at a time, a listing's page
 * and plan, the jobs that change an install, and sources, across every package kind. A write
 * answers with no body: the `store` poke tells every surface to read again.
 */
export const storeApi = {
  /** One page of a shelf or a search; `nextCursor` is where the next one starts. */
  async page(query: StorePageQuery = {}): Promise<ListingsResponse> {
    const { installed, limit, projectId, ...rest } = query
    return unwrap(
      await client.rpc.store.listings.$get({
        query: cleanQuery({
          ...rest,
          ...project(projectId),
          ...(installed === undefined ? {} : { installed: String(installed) }),
          ...(limit === undefined ? {} : { limit: String(limit) }),
        }),
      }),
    )
  },

  /** A listing's page; with the open project, its install there too. */
  async detail(ref: ListingRef, projectId?: string | null): Promise<ListingDetail> {
    return unwrap(await listing().$get({ ...param(ref), query: cleanQuery(project(projectId)) }))
  },

  async plan(ref: ListingRef, scope: Scope, projectId?: string | null): Promise<InstallPlan> {
    return unwrap(
      await listing().plan.$post({ ...param(ref), json: { scope, ...project(projectId) } }),
    )
  },

  /** Queue an install; `consent.plan` is the person's yes to what the plan warned about. */
  async install(
    ref: ListingRef,
    scope: Scope,
    consent: { plan: boolean },
    projectId?: string | null,
  ): Promise<void> {
    await assertOk(
      await listing().install.$post({
        ...param(ref),
        json: { scope, consent, ...project(projectId) },
      }),
    )
  },

  async update(ref: ListingRef, scope: Scope, projectId?: string | null): Promise<void> {
    await assertOk(
      await listing().update.$post({ ...param(ref), json: { scope, ...project(projectId) } }),
    )
  },

  async remove(ref: ListingRef, scope: Scope, projectId?: string | null): Promise<void> {
    await assertOk(
      await listing().remove.$post({ ...param(ref), json: { scope, ...project(projectId) } }),
    )
  },

  async setEnabled(
    ref: ListingRef,
    scope: Scope,
    enabled: boolean,
    projectId?: string | null,
  ): Promise<void> {
    await assertOk(
      await listing().enable.$post({
        ...param(ref),
        json: { scope, enabled, ...project(projectId) },
      }),
    )
  },

  /** The settings of one install, as its provider declares and stores them. */
  async config(ref: ListingRef, scope: Scope, projectId?: string | null): Promise<ListingConfig> {
    return unwrap(
      await listing().config.$get({
        ...param(ref),
        query: cleanQuery({ scope, ...project(projectId) }),
      }),
    )
  },

  /** Save the given keys of one install's settings; the provider validates and stores them. */
  async setConfig(
    ref: ListingRef,
    scope: Scope,
    values: Record<string, ConfigValue>,
    projectId?: string | null,
  ): Promise<void> {
    await assertOk(
      await listing().config.$post({
        ...param(ref),
        json: { scope, values, ...project(projectId) },
      }),
    )
  },

  /** Run one of an install's own actions (Test connection, Sign in) and say what happened. */
  async runAction(
    ref: ListingRef,
    scope: Scope,
    action: string,
    projectId?: string | null,
  ): Promise<ActionResult> {
    return unwrap(
      await listing().action.$post({
        ...param(ref),
        json: { scope, action, ...project(projectId) },
      }),
    )
  },

  /** The kinds whose provider can make a new item here. */
  async creatable(): Promise<PackageKind[]> {
    return (await unwrap(await client.rpc.store.create.$get())).kinds
  },

  /** The form for a new item of a kind. */
  async createFields(kind: PackageKind): Promise<CreateForm> {
    return unwrap(await client.rpc.store.create[':kind'].$get({ param: { kind } }))
  },

  /** Make an item from its form; answers its ref. */
  async create(
    kind: PackageKind,
    scope: Scope,
    values: Record<string, ConfigValue>,
    projectId?: string | null,
  ): Promise<ListingRef> {
    const made = await unwrap(
      await client.rpc.store.create[':kind'].$post({
        param: { kind },
        json: { scope, values, ...project(projectId) },
      }),
    )
    return made.ref
  },

  /** Every source, and the kinds a source can be added for. */
  async sources(): Promise<SourcesResponse> {
    return unwrap(await client.rpc.store.sources.$get())
  },

  /** Read a source before it is added; rejects with why it is not one. Writes nothing. */
  async previewSource(kind: PackageKind, input: string): Promise<SourcePreview> {
    return unwrap(await client.rpc.store.sources.preview.$post({ json: { kind, input } }))
  },

  async addSource(kind: PackageKind, input: string): Promise<void> {
    await assertOk(await client.rpc.store.sources.add.$post({ json: { kind, input } }))
  },

  async removeSource(kind: PackageKind, id: string): Promise<void> {
    await assertOk(await client.rpc.store.sources.remove.$post({ json: { kind, id } }))
  },

  /** Read one source again now. */
  async refreshSource(kind: PackageKind, id: string): Promise<void> {
    await assertOk(await client.rpc.store.sources.refresh.$post({ json: { kind, id } }))
  },

  /** Whether a source is read again, and what it installed updated, on its own. */
  async setSourceAutoUpdate(kind: PackageKind, id: string, autoUpdate: boolean): Promise<void> {
    await assertOk(
      await client.rpc.store.sources['auto-update'].$post({ json: { kind, id, autoUpdate } }),
    )
  },

  /** What Discover shows: the hero, its rows and every listing they name. */
  async discover(query: { projectId?: string | null } = {}): Promise<DiscoverResponse> {
    return unwrap(
      await client.rpc.store.discover.$get({ query: cleanQuery(project(query.projectId)) }),
    )
  },

  async activity(): Promise<StoreActivity> {
    return unwrap(await client.rpc.store.activity.$get())
  },

  /** Update all: every install a newer version is offered for. */
  async applyUpdates(): Promise<ListingRef[]> {
    return (await unwrap(await client.rpc.store.updates.apply.$post())).queued
  },
}

export type StoreClient = typeof storeApi
