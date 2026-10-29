import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db/types'
import { ConflictError, InvalidRequestError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import { recordCoreChanges } from '../changes/core-entities'
import { readMiniAppCatalogFeed } from './catalog-feed'
import type { MiniAppStoreSource } from './store-offers'

/** One catalog the store reads, as Settings lists it. */
export interface MiniAppCatalogRecord {
  url: string
  /** Comes with Localix: the hosted catalog. */
  builtIn: boolean
}

const urlOf = (source: MiniAppStoreSource) => source.url

/** An HTTPS URL or a `file://` path, or null: a catalog is fetched with no other scheme. */
export function normalizeCatalogUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' || url.protocol === 'file:' ? url.href : null
  } catch {
    return null
  }
}

/**
 * The catalogs the mini app store reads: the built-in ones, then those the person added, kept in
 * `mini_app_catalogs`. Adding one reads it first, so what is kept is a catalog. Every change is
 * announced as a `mini-app.catalog` notice in the same write (C1), and the store re-reads.
 * A publisher in an added catalog is never verified: Localix vouches only for its own.
 *
 * An added catalog keeps the key it was first read signed with (`catalog-signature.ts`): from then
 * on its apps update on their own only while it stays signed with that key. Removing it forgets
 * the key, which is how a person accepts a publisher's new one.
 */
export function createMiniAppCatalogs(deps: {
  db: Kysely<AppDatabase>
  builtIn: () => Promise<MiniAppStoreSource[]>
  fetchImpl?: typeof fetch
}) {
  const addedRows = () =>
    deps.db
      .selectFrom('mini_app_catalogs')
      .select(['url', 'signing_key'])
      .orderBy('added_at')
      .orderBy('url')
      .execute()
  const added = async () => (await addedRows()).map((row) => row.url)

  return {
    async list(): Promise<MiniAppCatalogRecord[]> {
      const builtIn = (await deps.builtIn()).map((source) => ({
        url: urlOf(source),
        builtIn: true,
      }))
      const known = new Set(builtIn.map(({ url }) => url))
      return [
        ...builtIn,
        ...(await added()).filter((url) => !known.has(url)).map((url) => ({ url, builtIn: false })),
      ]
    },

    /** What the store reads, in order: the built-in sources first, so they win a name. */
    async sources(): Promise<MiniAppStoreSource[]> {
      const builtIn = await deps.builtIn()
      const known = new Set(builtIn.map(urlOf))
      return [
        ...builtIn,
        ...(await addedRows())
          .filter(({ url }) => !known.has(url))
          .map(({ url, signing_key }): MiniAppStoreSource => ({
            kind: 'catalog',
            url,
            vouches: false,
            ...(signing_key ? { key: signing_key } : {}),
          })),
      ]
    },

    async add(raw: string): Promise<void> {
      const url = normalizeCatalogUrl(raw)
      if (!url)
        throw new InvalidRequestError(
          'mini_app_catalog_url',
          'A catalog is an HTTPS address or a file:// path to its mini-app-catalog.json',
        )
      let signingKey: string | null
      try {
        const { signature } = await readMiniAppCatalogFeed(url, { fetchImpl: deps.fetchImpl })
        signingKey = signature.state === 'signed' ? signature.key : null
      } catch (error) {
        throw new InvalidRequestError('mini_app_catalog_unreadable', errorMessage(error))
      }
      await deps.db.transaction().execute(async (trx) => {
        await trx
          .insertInto('mini_app_catalogs')
          .values({ url, added_at: new Date().toISOString(), signing_key: signingKey })
          .onConflict((conflict) => conflict.column('url').doNothing())
          .execute()
        await recordCoreChanges(trx, { entity: 'mini-app.catalog', op: 'upserted', ref: { url } })
      })
    },

    /**
     * Keep `key` for an added catalog that has none yet: one added before it was signed, at its
     * first signed read. A key already kept is never replaced here.
     */
    async pinKey(url: string, key: string): Promise<void> {
      await deps.db.transaction().execute(async (trx) => {
        const { numUpdatedRows } = await trx
          .updateTable('mini_app_catalogs')
          .set({ signing_key: key })
          .where('url', '=', url)
          .where('signing_key', 'is', null)
          .executeTakeFirst()
        if (numUpdatedRows > 0n)
          await recordCoreChanges(trx, { entity: 'mini-app.catalog', op: 'upserted', ref: { url } })
      })
    },

    async remove(raw: string): Promise<void> {
      const url = normalizeCatalogUrl(raw) ?? raw
      if ((await deps.builtIn()).some((source) => urlOf(source) === url))
        throw new ConflictError(
          'mini_app_catalog_built_in',
          'The Localix catalog comes with Localix and cannot be removed',
        )
      await deps.db.transaction().execute(async (trx) => {
        await trx.deleteFrom('mini_app_catalogs').where('url', '=', url).execute()
        await recordCoreChanges(trx, { entity: 'mini-app.catalog', op: 'deleted', ref: { url } })
      })
    },
  }
}

export type MiniAppCatalogs = ReturnType<typeof createMiniAppCatalogs>
