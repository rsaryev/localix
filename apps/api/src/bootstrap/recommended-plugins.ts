import type { StoreService } from '../features/store/service'

/**
 * The plugins Localix's own marketplace recommends, as the Store lists them, and whether each is
 * installed: what `features/plugins/recommended.ts` installs once. Only a marketplace Localix
 * vouches for can recommend (`store-editorial.ts`); null while none of its plugins is listed yet
 * (not registered, or not read), so the pass waits for it.
 */
export async function recommendedPlugins(
  store: Pick<StoreService, 'listings'>,
  userId: string,
): Promise<{ id: string; installed: boolean }[] | null> {
  const { listings } = await store.listings({ userId }, { shelf: 'package:plugin', limit: 500 })
  const localix = listings.filter((listing) => listing.source.trust === 'localix')
  if (localix.length === 0) return null
  return localix
    .filter((listing) => listing.recommended)
    .map((listing) => ({ id: listing.ref.id, installed: listing.installs.length > 0 }))
}
