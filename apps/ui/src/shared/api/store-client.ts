import type {
  InstallPlan,
  ListingDetail,
  ListingRef,
  ListingsResponse,
  PackageKind,
  Scope,
  SourcePreview,
  SourceView,
  StoreActivity,
} from '@localixai/store'
import { assertOk, cleanQuery, client, unwrap } from './internal'

const listing = () => client.rpc.store[':kind'][':id']
const param = (ref: ListingRef) => ({ param: { kind: ref.kind, id: ref.id } })

/**
 * The Store (`/rpc/store`, `docs/internals/store.md`): listings, a listing's page and plan, the
 * jobs that change an install, and sources, across every package kind. A write answers with no
 * body: the `store` poke tells every surface to read again.
 */
export const storeApi = {
  async listings(query: { shelf?: string; q?: string } = {}): Promise<ListingsResponse> {
    return unwrap(await client.rpc.store.listings.$get({ query: cleanQuery(query) }))
  },

  async detail(ref: ListingRef): Promise<ListingDetail> {
    return unwrap(await listing().$get(param(ref)))
  },

  async plan(ref: ListingRef, scope: Scope): Promise<InstallPlan> {
    return unwrap(await listing().plan.$post({ ...param(ref), json: { scope } }))
  },

  /** Queue an install; `consent.plan` is the person's yes to what the plan warned about. */
  async install(ref: ListingRef, scope: Scope, consent: { plan: boolean }): Promise<void> {
    await assertOk(await listing().install.$post({ ...param(ref), json: { scope, consent } }))
  },

  async update(ref: ListingRef, scope: Scope): Promise<void> {
    await assertOk(await listing().update.$post({ ...param(ref), json: { scope } }))
  },

  async remove(ref: ListingRef, scope: Scope): Promise<void> {
    await assertOk(await listing().remove.$post({ ...param(ref), json: { scope } }))
  },

  async setEnabled(ref: ListingRef, scope: Scope, enabled: boolean): Promise<void> {
    await assertOk(await listing().enable.$post({ ...param(ref), json: { scope, enabled } }))
  },

  async sources(): Promise<SourceView[]> {
    return (await unwrap(await client.rpc.store.sources.$get())).sources
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

  async activity(): Promise<StoreActivity> {
    return unwrap(await client.rpc.store.activity.$get())
  },

  /** Update all: every install a newer version is offered for. */
  async applyUpdates(): Promise<ListingRef[]> {
    return (await unwrap(await client.rpc.store.updates.apply.$post())).queued
  },
}

export type StoreClient = typeof storeApi
