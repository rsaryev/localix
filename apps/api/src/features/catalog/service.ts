import type { CatalogResponse } from './contracts'
import { sortCatalogModelsNewestFirst, sortProvidersOAuthFirst } from '@localixai/agent/catalog'

/** Engine-neutral model catalog source supplied by the runtime adapter. */
export interface CatalogSource {
  list(): CatalogResponse | Promise<CatalogResponse>
  /**
   * Changes whenever `list()` would answer differently. Absent means the answer never changes
   * (a fixed test catalog), and the first build is kept.
   */
  revision?(): number
}

export interface CatalogServiceDeps {
  source: CatalogSource
  /** Where a failed background warm-up is reported; the next read retries either way. */
  onWarmError?: (error: unknown) => void
}

/**
 * Read-only catalog facade. Provider discovery, model metadata and OAuth
 * capabilities belong to the runtime adapter, not to the application layer.
 *
 * The cache is keyed on the source's revision, not held for the process. A process-lifetime cache
 * froze the first build — the generated reasoning levels — while the adapter's background metadata
 * refresh corrected the levels the per-request clamp reads, so the picker offered a level the run
 * then refused. A build is still reused for as long as the revision stands, which is every read
 * between two refreshes.
 */
export function createCatalogService(deps: CatalogServiceDeps) {
  const revision = (): number => deps.source.revision?.() ?? 0
  let cache: { revision: number; catalog: CatalogResponse } | undefined
  let inflight: { revision: number; promise: Promise<CatalogResponse> } | undefined

  const build = (atRevision: number): Promise<CatalogResponse> =>
    // Through the executor so a source that THROWS rejects instead of escaping `warm()` uncaught.
    new Promise<CatalogResponse>((resolve) => resolve(deps.source.list())).then((catalog) => {
      const ordered = {
        ...catalog,
        providers: sortProvidersOAuthFirst(
          catalog.providers,
          catalog.oauthProviderIds,
          (provider) => provider.id,
        ),
        models: sortCatalogModelsNewestFirst(catalog.models),
      }
      // Tagged with the revision read BEFORE the build: a publish that lands mid-build leaves the
      // tag behind, so the next read rebuilds instead of keeping a half-stale answer.
      if (!cache || cache.revision <= atRevision) cache = { revision: atRevision, catalog: ordered }
      return ordered
    })

  const load = (): Promise<CatalogResponse> => {
    const current = revision()
    if (cache?.revision === current) return Promise.resolve(cache.catalog)
    if (inflight?.revision === current) return inflight.promise
    const promise = build(current).finally(() => {
      if (inflight?.promise === promise) inflight = undefined
    })
    inflight = { revision: current, promise }
    return promise
  }

  return {
    warm(): void {
      // A warm-up nobody awaits must not become an unhandled rejection. It caches nothing on
      // failure, so the first real read builds again and surfaces the error to its caller.
      load().catch((error: unknown) => deps.onWarmError?.(error))
    },
    getCatalog: load,
  }
}

export type CatalogService = ReturnType<typeof createCatalogService>
