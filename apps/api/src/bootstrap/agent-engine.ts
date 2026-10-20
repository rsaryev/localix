/**
 * The agent engine and the models on this computer it can run. The ONE place the engine is
 * constructed: every consumer downstream reads the neutral ports off `engine`. Refreshed catalogs
 * persist across launches.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bundledScriptSandboxOptions, createEngine } from '@localixai/engine'
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
  const scripts = bundledScriptSandboxOptions(dirname(fileURLToPath(import.meta.url)))
  const engine = createEngine({
    localProvider: localProviderHost(localModels),
    getDeviceId: createDeviceIdGetter(),
    catalogStore: createModelCatalogStore(),
    onCatalogEntryDropped: (providerId, reason) =>
      logger.info({ event: 'catalog.entry_dropped', providerId, reason }),
    // The packaged sidecar writes the sandbox's worker and VM beside its `server.js`; from source
    // they come from the installed package and nothing is passed.
    ...(scripts ? { scripts } : {}),
  })
  return { localModels, engine }
}
