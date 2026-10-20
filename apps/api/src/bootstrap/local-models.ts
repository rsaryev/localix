/**
 * Composition of local models: the one service that downloads, lists and serves models on this
 * computer, and the port the agent engine's `local` provider reads it through. Built before the
 * engine (the provider must exist when the catalog is first read); nothing starts here — the
 * router starts on the first request, and `boot()` only reads what is installed.
 */
import path from 'node:path'
import type { LocalProviderHost } from '@localixai/agent/runtime'
import { createLocalModelsService, type LocalModelsService } from '../features/local-models/service'
import { CHAT_CONTEXT_FALLBACK } from '../features/local-models/router'
import { localixHome } from '../lib/env'
import type { createLogger } from '../lib/logger'

/** Room left for the answer in a local model's context. */
const LOCAL_MAX_OUTPUT_TOKENS = 8192

export function buildLocalModels(deps: {
  logger: ReturnType<typeof createLogger>
  /** `LOCALIX_MODELS_DIR`; defaults to `~/.localix/models`. */
  root?: string
  /** `HF_TOKEN`: higher Hugging Face rate limits for the catalog. */
  hfToken?: string
}) {
  return createLocalModelsService({
    root: deps.root?.trim() || path.join(localixHome(), 'models'),
    log: (event, fields) => deps.logger.info({ event, ...fields }),
    hfToken: deps.hfToken?.trim() || undefined,
  })
}

export function localProviderHost(localModels: LocalModelsService): LocalProviderHost {
  return {
    // What is on this computer: models are found and downloaded in Settings → Models.
    models: () =>
      localModels.installed('chat').map((spec) => {
        // The context the server is started with for this computer — what the agent may fill.
        const contextWindow =
          localModels.planOf(spec.id)?.context ??
          Math.min(spec.contextLength ?? 8192, CHAT_CONTEXT_FALLBACK)
        return {
          id: spec.id,
          name: spec.label,
          contextWindow,
          maxTokens: Math.min(LOCAL_MAX_OUTPUT_TOKENS, Math.floor(contextWindow / 2)),
          vision: spec.vision,
          reasoning: spec.reasoning ?? false,
        }
      }),
    isInstalled: (...args) => localModels.isInstalled(...args),
    whenReady: (modelId, signal) => {
      const label = localModels.installed().find((s) => s.id === modelId)?.label
      return localModels.whenReady(modelId, label ?? modelId, signal)
    },
    endpoint: async () => {
      const server = await localModels.router.ensure()
      return { baseUrl: server.baseUrl, apiKey: server.apiKey }
    },
  }
}
