import type { Kysely } from 'kysely'
import { GITHUB_REPO_RE, githubMarketplaceUrl } from '@localixai/mini-app-sdk/marketplace'

import type { AppDatabase } from '../../db/types'
import { ConflictError, InvalidRequestError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import { recordCoreChanges } from '../changes/core-entities'
import { readMarketplaceFeed } from './marketplace-feed'
import { judgeMarketplace, type KeptTrust } from './marketplace-trust'

/**
 * THE MARKETPLACES THE MINI APP STORE READS (`docs/extending/mini-app-marketplace.md`): the
 * built-in ones, then those the person added, kept in `mini_app_marketplaces` under the name each
 * calls itself — unique on this computer, since it is half of every app's identity. Adding one
 * reads it first, so what is kept is a marketplace. What Localix keeps to judge each
 * marketplace's signatures (`marketplace-trust.ts`) is kept here for every one read: built in,
 * added, or linked from a list. Every change is announced as a `mini-app.marketplace` notice in
 * the same write (C1), and the store re-reads.
 */

/** One marketplace the store reads. */
export interface MiniAppMarketplaceSource {
  url: string
  /** Its name: a built-in one's own, or the one an added one had when it was added. */
  name: string
  /** Localix trusts it: its curation counts and its publishers are verified. */
  vouches: boolean
  builtIn: boolean
  /** The keys Localix ships for it (`marketplace-trust.ts`). */
  pinned?: readonly string[]
  /** The default source a built-in one is (`@localixai/store`'s `DEFAULT_SOURCES`). */
  id?: string
}

/**
 * What a person types to add one: an HTTPS address, a `file://` path, or a GitHub repository's
 * `owner/name`, which is the marketplace its latest release publishes. Null for anything else.
 */
export function marketplaceUrlOf(raw: string): string | null {
  const input = raw.trim()
  if (GITHUB_REPO_RE.test(input) && !input.includes('://')) return githubMarketplaceUrl(input)
  try {
    const url = new URL(input)
    return url.protocol === 'https:' || url.protocol === 'file:' ? url.href : null
  } catch {
    return null
  }
}

const parseKeys = (text: string | null): string[] | undefined => {
  if (!text) return undefined
  const parsed = JSON.parse(text) as unknown
  return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []
}

export function createMiniAppMarketplaces(deps: {
  db: Kysely<AppDatabase>
  builtIn: () => Promise<MiniAppMarketplaceSource[]>
  fetchImpl?: typeof fetch
}) {
  const added = () =>
    deps.db
      .selectFrom('mini_app_marketplaces')
      .select(['url', 'name'])
      .orderBy('added_at')
      .orderBy('url')
      .execute()

  async function list(): Promise<MiniAppMarketplaceSource[]> {
    const builtIn = await deps.builtIn()
    const known = new Set(builtIn.map(({ url }) => url))
    return [
      ...builtIn,
      ...(await added())
        .filter(({ url }) => !known.has(url))
        .map(({ url, name }) => ({ url, name, vouches: false, builtIn: false })),
    ]
  }

  const trust = {
    async get(url: string): Promise<KeptTrust | undefined> {
      const row = await deps.db
        .selectFrom('mini_app_marketplace_trust')
        .select(['signing_keys', 'published', 'root'])
        .where('url', '=', url)
        .executeTakeFirst()
      if (!row) return undefined
      const root = parseKeys(row.root)
      return {
        keys: parseKeys(row.signing_keys) ?? [],
        ...(row.published ? { published: row.published } : {}),
        ...(root ? { root } : {}),
      }
    },

    /** Keep what judging a read of `url` decided (`judgeMarketplace`'s `keep`). */
    async keep(url: string, kept: KeptTrust): Promise<void> {
      await deps.db.transaction().execute(async (trx) => {
        const row = {
          signing_keys: JSON.stringify(kept.keys),
          published: kept.published ?? null,
          root: kept.root ? JSON.stringify(kept.root) : null,
          updated_at: new Date().toISOString(),
        }
        await trx
          .insertInto('mini_app_marketplace_trust')
          .values({ url, ...row })
          .onConflict((conflict) => conflict.column('url').doUpdateSet(row))
          .execute()
        await recordCoreChanges(trx, {
          entity: 'mini-app.marketplace',
          op: 'upserted',
          ref: { url },
        })
      })
    },
  }

  return {
    /** What the store reads, in order: the built-in ones first, so they win a name. */
    list,

    /**
     * Read the marketplace at `raw` and keep it, with what its first read is trusted for. Refused
     * when it cannot be read, or when its name is one already on this computer.
     */
    async add(raw: string): Promise<{ url: string; name: string }> {
      const url = marketplaceUrlOf(raw)
      if (!url)
        throw new InvalidRequestError(
          'mini_app_marketplace_url',
          'A marketplace is an https:// address, a file:// path or a GitHub owner/name',
        )
      let feed: Awaited<ReturnType<typeof readMarketplaceFeed>>
      try {
        feed = await readMarketplaceFeed(url, { fetchImpl: deps.fetchImpl })
      } catch (error) {
        throw new InvalidRequestError('mini_app_marketplace_unreadable', errorMessage(error))
      }
      const { name, published, signingKeys } = feed.marketplace
      const known = await list()
      if (known.some((source) => source.url === url)) return { url, name }
      const holder = known.find((source) => source.name === name)
      if (holder)
        throw new ConflictError(
          'mini_app_marketplace_name_taken',
          `A marketplace named "${name}" is already on this computer (${holder.url}); remove it first`,
        )
      const { keep } = judgeMarketplace({
        signatures: feed.signatures,
        ...(published ? { published } : {}),
        ...(signingKeys ? { signingKeys } : {}),
        kept: undefined,
        firstUse: true,
      })
      await deps.db.transaction().execute(async (trx) => {
        await trx
          .insertInto('mini_app_marketplaces')
          .values({ url, name, added_at: new Date().toISOString() })
          .execute()
        if (keep)
          await trx
            .insertInto('mini_app_marketplace_trust')
            .values({
              url,
              signing_keys: JSON.stringify(keep.keys),
              published: keep.published ?? null,
              root: null,
              updated_at: new Date().toISOString(),
            })
            .onConflict((conflict) =>
              conflict.column('url').doUpdateSet({
                signing_keys: JSON.stringify(keep.keys),
                published: keep.published ?? null,
              }),
            )
            .execute()
        await recordCoreChanges(trx, {
          entity: 'mini-app.marketplace',
          op: 'upserted',
          ref: { url },
        })
      })
      return { url, name }
    },

    /** Forget one the person added, and what was kept for it: adding it again trusts it afresh. */
    async remove(raw: string): Promise<void> {
      const url = marketplaceUrlOf(raw) ?? raw
      if ((await deps.builtIn()).some((source) => source.url === url))
        throw new ConflictError(
          'mini_app_marketplace_built_in',
          'This marketplace comes with Localix and cannot be removed',
        )
      await deps.db.transaction().execute(async (trx) => {
        await trx.deleteFrom('mini_app_marketplaces').where('url', '=', url).execute()
        await trx.deleteFrom('mini_app_marketplace_trust').where('url', '=', url).execute()
        await recordCoreChanges(trx, {
          entity: 'mini-app.marketplace',
          op: 'deleted',
          ref: { url },
        })
      })
    },

    trust,
  }
}

export type MiniAppMarketplaces = ReturnType<typeof createMiniAppMarketplaces>
