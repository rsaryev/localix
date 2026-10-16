/**
 * The Pi ENGINE: the four adapter constructors as one `AgentEngine`, so the host's composition
 * root names the adapter once and every phase after it is typed by the neutral ports.
 *
 * Tuning that every provider request shares (retries, the per-request deadline) is given
 * once and fanned out to the loop and the completion factory — two places that used to be
 * tuned by two copies of the same two numbers.
 */
import type { AgentEngine } from '@localixai/agent/runtime'

import { createPiAuthRuntime } from './auth'
import { createPiLanguageModelFactory } from './language-model'
import type { PiModelMiddleware } from './middleware'
import { listPiCatalog, piCatalogRevision, type CatalogMetadataStore } from './models'
import { createPiAgentRuntime } from './runtime'
import { requestTuning, type PiRequestTuning } from './stream-options'

export interface PiEngineOptions extends PiRequestTuning {
  /** Deployment-wide middleware around every agent-loop model call (a watchdog, a shim). */
  middleware?: readonly PiModelMiddleware[]
  /** Where the catalog's release metadata persists between launches. */
  catalogMetadataStore?: CatalogMetadataStore
  /** Stable installation identity, persisted by the host rather than the runtime. */
  getDeviceId?: () => string
}

export function createPiEngine(options: PiEngineOptions = {}): AgentEngine {
  const shared = requestTuning(options)
  const runtime = createPiAgentRuntime({
    ...shared,
    ...(options.middleware ? { middleware: options.middleware } : {}),
  })
  return {
    id: runtime.adapter.id,
    version: runtime.adapter.version,
    runtime,
    languageModels: createPiLanguageModelFactory(shared),
    createAuth: (credentialStore) =>
      createPiAuthRuntime({ credentialStore, getDeviceId: options.getDeviceId }),
    listCatalog: () =>
      listPiCatalog(
        options.catalogMetadataStore ? { metadataStore: options.catalogMetadataStore } : {},
      ),
    catalogRevision: piCatalogRevision,
  }
}
