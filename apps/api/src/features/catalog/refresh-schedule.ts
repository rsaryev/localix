import type {
  EngineCatalogRefreshOptions,
  EngineCatalogRefreshResult,
} from '@localixai/agent/runtime'

import { envFlag } from '../../lib/env'
import { errorMessage } from '../../lib/errors'
import type { CatalogService } from './service'

/**
 * How often the server asks the adapter to check the model list. The adapter skips a provider
 * whose persisted catalog is younger than its own freshness window (six hours), so most checks
 * read local files only; checking hourly bounds how long a stale list outlives that window.
 */
export const MODEL_CATALOG_CHECK_INTERVAL_MS = 60 * 60 * 1000

/**
 * `LOCALIX_MODEL_CATALOG_REFRESH=0` turns off the automatic model-list checks (after startup and
 * hourly). The persisted list is still restored, and **Check for new models** in Settings → System
 * still fetches on request.
 */
export function modelCatalogRefreshEnabled(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return envFlag('LOCALIX_MODEL_CATALOG_REFRESH', true, source)
}

interface CatalogLogger {
  info(detail: Record<string, unknown>): void
  warn(detail: Record<string, unknown>): void
}

/** The catalog service's `onRefresh`: one log line per refresh, a warning when providers failed. */
export function logCatalogRefresh(logger: CatalogLogger) {
  return (result: EngineCatalogRefreshResult, options: EngineCatalogRefreshOptions): void => {
    const messages = [...new Set(result.errors.map((error) => error.message))]
    const detail = {
      event: 'catalog.refreshed',
      network: options.allowNetwork,
      changed: result.changed,
      failed: result.errors.length,
      ...(messages.length > 0 ? { errors: messages } : {}),
    }
    if (messages.length > 0) logger.warn(detail)
    else logger.info(detail)
  }
}

/**
 * Arm the hourly model-list check and return the first one, for the idle scheduler to run after
 * startup. Undefined when `LOCALIX_MODEL_CATALOG_REFRESH=0`. A failure keeps the previous list.
 */
export function armModelCatalogChecks(deps: {
  catalogService: Pick<CatalogService, 'check'>
  signal: AbortSignal
  logger: CatalogLogger
  source?: Record<string, string | undefined>
}): (() => Promise<void>) | undefined {
  if (!modelCatalogRefreshEnabled(deps.source)) return undefined
  const check = () =>
    deps.catalogService.check({ signal: deps.signal }).then(
      () => undefined,
      (error: unknown) =>
        deps.logger.warn({ event: 'catalog.check_failed', error: errorMessage(error) }),
    )
  setInterval(() => void check(), MODEL_CATALOG_CHECK_INTERVAL_MS).unref?.()
  return check
}
