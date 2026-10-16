import type {
  EngineCatalogRefreshOptions,
  EngineCatalogRefreshResult,
} from '@localixai/agent/runtime'
import type { CatalogRefreshResponse, CatalogResponse } from './contracts'
import { sortCatalogModelsNewestFirst, sortProvidersOAuthFirst } from '@localixai/agent/catalog'

/** Engine-neutral model catalog source supplied by the runtime adapter. */
export interface CatalogSource {
  list(): CatalogResponse | Promise<CatalogResponse>
  /** Restore persisted catalogs and, with `allowNetwork`, fetch newer ones. Absent: a fixed catalog. */
  refresh?(options: EngineCatalogRefreshOptions): Promise<EngineCatalogRefreshResult>
}

export interface CatalogServiceDeps {
  source: CatalogSource
  /** Where a failed background warm-up is reported; the next read retries either way. */
  onWarmError?: (error: unknown) => void
  /** Every refresh's outcome, for the log. */
  onRefresh?: (result: EngineCatalogRefreshResult, options: EngineCatalogRefreshOptions) => void
}

/** One line for a refresh whose providers failed: they fail together when a shared source does. */
function summarize(result: EngineCatalogRefreshResult): CatalogRefreshResponse {
  const messages = [...new Set(result.errors.map((error) => error.message))]
  return {
    ok: result.errors.length === 0 && !result.aborted,
    changed: result.changed,
    failedProviders: result.errors.map((error) => error.providerId),
    ...(messages.length > 0 ? { message: messages.join('; ') } : {}),
  }
}

/**
 * Read-only catalog facade. Provider discovery, model metadata and OAuth
 * capabilities belong to the runtime adapter, not to the application layer.
 *
 * This is the ONE place the catalog is ordered: providers OAuth-first, models newest-first by the
 * adapter's release date (undated last, in source order). Every surface — the picker, its search
 * and filter results, the per-connection lists, `/model` — reads this order and keeps it.
 *
 * A build is kept until the adapter reports that a refresh published a new model list; a failed
 * build caches nothing and the next read retries. Reads wait for the startup restore of persisted
 * catalogs, which is local and short, so the first answer already includes them.
 */
export function createCatalogService(deps: CatalogServiceDeps) {
  let loaded: Promise<CatalogResponse> | undefined
  let restoring: Promise<void> | undefined
  let checking: Promise<CatalogRefreshResponse> | undefined

  const build = (): Promise<CatalogResponse> =>
    // Through the executor so a source that THROWS rejects instead of escaping `warm()` uncaught.
    new Promise<CatalogResponse>((resolve) => resolve(deps.source.list())).then((catalog) => ({
      ...catalog,
      providers: sortProvidersOAuthFirst(
        catalog.providers,
        catalog.oauthProviderIds,
        (provider) => provider.id,
      ),
      models: sortCatalogModelsNewestFirst(catalog.models),
    }))

  const load = async (): Promise<CatalogResponse> => {
    if (restoring) await restoring
    if (loaded) return loaded
    const promise = build()
    loaded = promise
    promise.catch(() => {
      if (loaded === promise) loaded = undefined
    })
    return promise
  }

  const refresh = async (
    options: EngineCatalogRefreshOptions,
  ): Promise<EngineCatalogRefreshResult | undefined> => {
    if (!deps.source.refresh) return undefined
    const result = await deps.source.refresh(options)
    // The adapter's signal from pi: a provider published a new list, so this build is stale.
    if (result.changed) loaded = undefined
    deps.onRefresh?.(result, options)
    return result
  }

  return {
    warm(): void {
      // A warm-up nobody awaits must not become an unhandled rejection. It caches nothing on
      // failure, so the first real read builds again and surfaces the error to its caller.
      load().catch((error: unknown) => deps.onWarmError?.(error))
    },
    getCatalog: load,

    /** Restore the persisted catalogs, without network access. Reads wait for it. */
    restore(): Promise<void> {
      restoring ??= refresh({ allowNetwork: false }).then(
        () => undefined,
        (error: unknown) => deps.onWarmError?.(error),
      )
      return restoring
    },

    /**
     * Fetch newer catalogs. `force` checks every source now; otherwise a provider checked within
     * the adapter's freshness window is skipped. Concurrent checks share one run.
     */
    check(
      options: { force?: boolean; signal?: AbortSignal } = {},
    ): Promise<CatalogRefreshResponse> {
      checking ??= (async () => {
        try {
          if (restoring) await restoring
          const result = await refresh({ allowNetwork: true, ...options })
          return result
            ? summarize(result)
            : { ok: true, changed: false, failedProviders: [] as string[] }
        } finally {
          checking = undefined
        }
      })()
      return checking
    },
  }
}

export type CatalogService = ReturnType<typeof createCatalogService>
