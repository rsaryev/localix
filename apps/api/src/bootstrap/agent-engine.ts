/**
 * The agent engine and the models on this computer it can run. The ONE place the adapter is
 * named: swapping engines is this file; every consumer downstream reads the neutral ports off
 * `engine`. Refreshed catalogs persist across launches.
 *
 * A provider that accepts the request and then goes quiet used to stall a run for pi's SDK
 * transport default (~10 minutes) — the only ceiling, since no timeoutMs was set. The watchdog
 * bounds SILENCE rather than the whole request, so a long answer that keeps streaming is
 * untouched while a stalled one fails in minutes.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  bundledScriptSandboxOptions,
  createPiEngine,
  streamIdleWatchdog,
} from '@localixai/agent-runtime-pi'
import { createModelCatalogStore } from '../features/catalog/models-store'
import { createDeviceIdGetter } from '../features/provider-connections/device-id'
import type { loadEnv } from '../lib/env'
import type { createLogger } from '../lib/logger'
import { buildLocalModels, localProviderHost } from './local-models'

export function buildAgentEngine(deps: {
  logger: ReturnType<typeof createLogger>
  env: Pick<ReturnType<typeof loadEnv>, 'LOCALIX_MODELS_DIR' | 'HF_TOKEN'>
}) {
  const { logger, env } = deps
  const localModels = buildLocalModels({
    logger,
    root: env.LOCALIX_MODELS_DIR,
    hfToken: env.HF_TOKEN,
  })
  const engine = createPiEngine({
    localProvider: localProviderHost(localModels),
    maxRetries: 2,
    maxRetryDelayMs: 60_000,
    middleware: [streamIdleWatchdog()],
    getDeviceId: createDeviceIdGetter(),
    catalogStore: createModelCatalogStore(),
    onCatalogEntryDropped: (providerId, reason) =>
      logger.info({ event: 'catalog.entry_dropped', providerId, reason }),
    // The packaged sidecar writes the sandbox's worker and VM beside its `server.js`; from source
    // they come from the installed package and nothing is passed.
    scripts: bundledScriptSandboxOptions(dirname(fileURLToPath(import.meta.url))),
  })
  return { localModels, engine }
}
