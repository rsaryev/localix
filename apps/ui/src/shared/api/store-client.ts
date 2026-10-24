import {
  LISTINGS_PAGE_MAX,
  type InstallPlan,
  type ListingDetail,
  type ListingRef,
  type ListingsResponse,
  type PackageKind,
  type Scope,
  type SourcePreview,
  type SourceView,
  type StoreActivity,
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
  /**
   * A shelf or a search, every page of it: the server answers a page at a time, and the Store's
   * screens show the whole list until they scroll page by page.
   */
  async listings(query: { shelf?: string; q?: string } = {}): Promise<ListingsResponse> {
    const read = (cursor?: string) =>
      client.rpc.store.listings.$get({
        query: cleanQuery({ ...query, limit: String(LISTINGS_PAGE_MAX), cursor }),
      })
    const first: ListingsResponse = await unwrap(await read())
    const listings = [...first.listings]
    let next = first.nextCursor
    while (next) {
      const page: ListingsResponse = await unwrap(await read(next))
      listings.push(...page.listings)
      next = page.nextCursor
    }
    const { nextCursor: _done, ...rest } = first
    return { ...rest, listings }
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
