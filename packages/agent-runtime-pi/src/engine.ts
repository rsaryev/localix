/**
 * The Pi ENGINE: the adapter constructors as one `AgentEngine`, so the host's composition
 * root names the adapter once and every phase after it is typed by the neutral ports.
 *
 * Tuning that every provider request shares (retries, the per-request deadline) is given
 * once and fanned out to the loop and the completion factory — two places that used to be
 * tuned by two copies of the same two numbers.
 */
import type { AgentEngine, EngineCatalogStore } from '@localixai/agent/runtime'

import { createPiAuthRuntime } from './auth'
import { createPiLanguageModelFactory } from './language-model'
import type { PiModelMiddleware } from './middleware'
import { createPiCatalog } from './catalog'
import { createLocalProvider, type LocalProviderHost } from './local-provider'
import { registerPiProvider } from './providers'
import { createPiAgentRuntime } from './runtime'
import { createPiScriptSandbox, type PiScriptSandboxOptions } from './scripts'
import { requestTuning, type PiRequestTuning } from './stream-options'

export interface PiEngineOptions extends PiRequestTuning {
  /** Deployment-wide middleware around every agent-loop model call (a watchdog, a shim). */
  middleware?: readonly PiModelMiddleware[]
  /** Stable installation identity, persisted by the host rather than the runtime. */
  getDeviceId?: () => string
  /** Where refreshed model catalogs persist between launches. Without it they last for the process. */
  catalogStore?: EngineCatalogStore
  /** A persisted catalog entry was dropped instead of restored. */
  onCatalogEntryDropped?: (providerId: string, reason: string) => void
  /** Models on this computer, served by the host: registered as the `local` provider. */
  localProvider?: LocalProviderHost
  /** Where the script sandbox finds its wasm and worker when the host is bundled (`./scripts`). */
  scripts?: PiScriptSandboxOptions
}

export function createPiEngine(options: PiEngineOptions = {}): AgentEngine {
  const shared = requestTuning(options)
  // Before the catalog's collection is built, so it lists the provider from the first read.
  if (options.localProvider) registerPiProvider(createLocalProvider(options.localProvider))
  const catalog = createPiCatalog({
    ...(options.catalogStore ? { store: options.catalogStore } : {}),
    ...(options.onCatalogEntryDropped ? { onDropped: options.onCatalogEntryDropped } : {}),
  })
  const runtime = createPiAgentRuntime({
    ...shared,
    ...(options.middleware ? { middleware: options.middleware } : {}),
  })
  return {
    id: runtime.adapter.id,
    version: runtime.adapter.version,
    runtime,
    languageModels: createPiLanguageModelFactory(shared),
    scripts: createPiScriptSandbox(options.scripts),
    createAuth: (credentialStore) =>
      createPiAuthRuntime({ credentialStore, getDeviceId: options.getDeviceId }),
    listCatalog: () => catalog.list(),
    refreshCatalog: (refresh) => catalog.refresh(refresh),
    invalidateCatalog: () => catalog.invalidate(),
  }
}
