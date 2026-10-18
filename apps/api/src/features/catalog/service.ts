import type {
  EngineCatalogRefreshOptions,
  EngineCatalogRefreshResult,
} from '@localixai/agent/runtime'
import type { CatalogRefreshResponse, CatalogResponse } from './contracts'
import {
  modelKindOf,
  sortCatalogModelsNewestFirst,
  sortProvidersOAuthFirst,
} from '@localixai/agent/catalog'

/** Engine-neutral model catalog source supplied by the runtime adapter. */
export interface CatalogSource {
  list(): CatalogResponse | Promise<CatalogResponse>
  /** Restore persisted catalogs and, with `allowNetwork`, fetch newer ones. Absent: a fixed catalog. */
  refresh?(options: EngineCatalogRefreshOptions): Promise<EngineCatalogRefreshResult>
}

/**
 * Models of another kind than the runtime's chat models (embedding models today), contributed
 * by the feature that runs them and listed in the same catalog: one list, every kind, each
 * consumer asking for its own. A source signals `invalidate` when its list changes.
 */
export interface CatalogModelSource {
  id: string
  list(): Promise<CatalogResponse['models']>
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

  const modelSources = new Map<string, CatalogModelSource>()
  const chatViews = new WeakMap<CatalogResponse, CatalogResponse>()

  /** Contributed models, named by their provider; a failing source contributes nothing. */
  const contributed = async (providers: CatalogResponse['providers']) => {
    const names = new Map(providers.map((p) => [p.id, p.name]))
    const lists = await Promise.all(
      [...modelSources.values()].map((source) => source.list().catch(() => [])),
    )
    return lists.flat().map((model) => ({
      ...model,
      providerName: names.get(model.providerId) ?? model.providerName,
    }))
  }

  const build = (): Promise<CatalogResponse> =>
    // Through the executor so a source that THROWS rejects instead of escaping `warm()` uncaught.
    new Promise<CatalogResponse>((resolve) => resolve(deps.source.list())).then(
      async (catalog) => ({
        ...catalog,
        providers: sortProvidersOAuthFirst(
          catalog.providers,
          catalog.oauthProviderIds,
          (provider) => provider.id,
        ),
        models: sortCatalogModelsNewestFirst([
          ...catalog.models,
          ...(await contributed(catalog.providers)),
        ]),
      }),
    )

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
    /**
     * The chat catalog: what every chat surface on the server lists and resolves against
     * (`/model`, search, plugin channels, model resolution). One object per build.
     */
    async getCatalog(): Promise<CatalogResponse> {
      const full = await load()
      let chat = chatViews.get(full)
      if (!chat) {
        chat = { ...full, models: full.models.filter((m) => modelKindOf(m) === 'chat') }
        chatViews.set(full, chat)
      }
      return chat
    },
    /** Every kind of model — what the catalog route serves, each client asking for its own. */
    getFullCatalog: load,

    /** A host-owned provider's model list changed (local models): build again on next read. */
    invalidate(): void {
      loaded = undefined
    },

    /** Add models of another kind to the catalog (see {@link CatalogModelSource}). */
    registerModelSource(source: CatalogModelSource): () => void {
      modelSources.set(source.id, source)
      loaded = undefined
      return () => {
        if (modelSources.get(source.id) === source) modelSources.delete(source.id)
        loaded = undefined
      }
    },

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
