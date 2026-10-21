import { useCallback, useMemo, useState } from 'react'
import type { CatalogModel } from '@localixai/agent/catalog'
import type { ProviderConnection } from '@/shared/api/contracts'
import { resolveModelEntries, searchModelEntries } from './resolvedModelEntries'
import {
  getFavoriteModels,
  isFavoriteModel,
  toggleFavorite,
  type FavoriteModel,
} from './favoriteModels'

/**
 * Recent and Favorites, resolved against live connections + catalog (stale entries drop), then
 * narrowed by the model search. Owns the favorites list; recent picks come from task routing.
 */
export function useModelShortlists(
  recent: readonly { connectionId: string; modelId: string }[],
  models: CatalogModel[],
  connections: ProviderConnection[],
  search: string,
) {
  const [favorites, setFavorites] = useState<FavoriteModel[]>(() => getFavoriteModels())
  const validRecent = useMemo(
    () => resolveModelEntries(recent, models, connections),
    [connections, models, recent],
  )
  const resolvedRecent = useMemo(
    () => searchModelEntries(validRecent, search),
    [validRecent, search],
  )
  const validFavorites = useMemo(
    () => resolveModelEntries(favorites, models, connections),
    [connections, favorites, models],
  )
  const resolvedFavorites = useMemo(
    () => searchModelEntries(validFavorites, search),
    [validFavorites, search],
  )
  const isFavorite = useCallback(
    (connectionId: string, modelId: string) =>
      isFavoriteModel(favorites, { connectionId, modelId }),
    [favorites],
  )
  const toggleFav = useCallback((connectionId: string, modelId: string) => {
    setFavorites(toggleFavorite({ connectionId, modelId }))
  }, [])
  return {
    recentCount: validRecent.length,
    favoriteCount: validFavorites.length,
    resolvedRecent,
    resolvedFavorites,
    isFavorite,
    toggleFav,
  }
}
