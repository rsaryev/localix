import type { CatalogModel } from './types'

/**
 * Sort provider-like values by OAuth capability while preserving their source
 * order within both bands. `oauthProviderIds` is authoritative because a
 * provider may support both OAuth and API keys while exposing `api-key` as its
 * default auth type.
 */
export function sortProvidersOAuthFirst<T>(
  providers: readonly T[],
  oauthProviderIds: ReadonlySet<string> | readonly string[],
  providerId: (provider: T) => string,
): T[] {
  const oauthIds = oauthProviderIds instanceof Set ? oauthProviderIds : new Set(oauthProviderIds)
  return [...providers].sort(
    (left, right) =>
      Number(oauthIds.has(providerId(right))) - Number(oauthIds.has(providerId(left))),
  )
}

function releaseTimestamp(model: CatalogModel): number | undefined {
  const value = model.releaseDate?.trim()
  if (!value) return undefined

  // Runtime adapters own this metadata and currently emit RFC 3339/ISO 8601.
  // `Date.parse` alone is deliberately permissive (`2025`, `01/02/03`, and even
  // some impossible calendar dates are accepted differently across engines),
  // which would let malformed plugin metadata reorder the shared model catalog.
  // Require an unambiguous calendar date, optionally followed by an ISO time and
  // explicit timezone, before asking the engine for its timestamp.
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value)
  if (!match) return undefined
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return undefined

  // Date parsing may normalize an impossible date (for example February 30)
  // into the following month. Verify the source calendar components explicitly.
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const calendarProbe = new Date(Date.UTC(year, month - 1, day))
  return calendarProbe.getUTCFullYear() === year &&
    calendarProbe.getUTCMonth() === month - 1 &&
    calendarProbe.getUTCDate() === day
    ? timestamp
    : undefined
}

/**
 * Newest dated models first. Equal-date and undated models retain the runtime
 * adapter's authoritative source order. A model id is an opaque provider key,
 * not release metadata: lexical/numeric guesses break on aliases (`latest`),
 * dated suffixes, custom gateways, and colliding ids from different providers.
 */
export function compareCatalogModelsNewestFirst(left: CatalogModel, right: CatalogModel): number {
  const leftTimestamp = releaseTimestamp(left)
  const rightTimestamp = releaseTimestamp(right)

  if (leftTimestamp !== undefined && rightTimestamp === undefined) return -1
  if (leftTimestamp === undefined && rightTimestamp !== undefined) return 1
  if (
    leftTimestamp !== undefined &&
    rightTimestamp !== undefined &&
    leftTimestamp !== rightTimestamp
  ) {
    return rightTimestamp - leftTimestamp
  }

  return 0
}

/** Return a sorted copy; runtime-owned catalog arrays are never mutated. */
export function sortCatalogModelsNewestFirst(models: readonly CatalogModel[]): CatalogModel[] {
  return [...models].sort(compareCatalogModelsNewestFirst)
}
