/**
 * Favorite (pinned) models for the model picker.
 *
 * A dedicated "Favorites" sidebar entry plus a per-row star toggle in the
 * cross-provider model picker: a persisted list of pairs, prepend-on-add,
 * remove-on-toggle, filtered to still-valid entries at render.
 *
 * Like a recent entry, a favorite is a (connectionId, modelId) pair — Localix
 * picks are per CONNECTION, not per provider, so two connections to the same
 * provider stay distinct. Unlike recents (which are auto-ordered by use), the
 * favorite list is user-curated: toggling on prepends, toggling off removes, and
 * the order is otherwise stable. A generous cap guards storage. Stale entries
 * (connection removed / model gone) are filtered out at render time by the caller.
 */
import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'

export interface FavoriteModel {
  connectionId: string
  modelId: string
}

const STORAGE_KEY = 'localix.models.favorites'
export const FAVORITE_MODELS_CAP = 30

function sameEntry(a: FavoriteModel, b: FavoriteModel): boolean {
  return a.connectionId === b.connectionId && a.modelId === b.modelId
}

/** Whether `entry` is present in `list`. Pure. */
export function isFavoriteModel(list: readonly FavoriteModel[], entry: FavoriteModel): boolean {
  return list.some((x) => sameEntry(x, entry))
}

/**
 * Return a new list with `entry` toggled: removed if already present, else
 * prepended (most-recently-favorited first) and capped. Pure — no I/O.
 */
export function toggleFavoriteModel(
  list: readonly FavoriteModel[],
  entry: FavoriteModel,
  cap = FAVORITE_MODELS_CAP,
): FavoriteModel[] {
  if (isFavoriteModel(list, entry)) {
    return list.filter((x) => !sameEntry(x, entry))
  }
  return [entry, ...list].slice(0, Math.max(0, cap))
}

function read(): FavoriteModel[] {
  const parsed = loadJSON<unknown>(STORAGE_KEY)
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter(
      (v): v is FavoriteModel =>
        !!v && typeof v.connectionId === 'string' && typeof v.modelId === 'string',
    )
    .slice(0, FAVORITE_MODELS_CAP)
}

function write(list: FavoriteModel[]): void {
  saveJSON(STORAGE_KEY, list)
}

/** Current favorite models, most-recently-favorited first. */
export function getFavoriteModels(): FavoriteModel[] {
  return read()
}

/** Toggle a model's favorite state and persist. Returns the new list. */
export function toggleFavorite(entry: FavoriteModel): FavoriteModel[] {
  const next = toggleFavoriteModel(read(), entry)
  write(next)
  return next
}
