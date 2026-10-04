import { createCapabilityContextProvider } from '../features/capabilities/context-provider'
import { createCapabilityResourceProvider } from '../features/capabilities/resource-provider'
import { createContextManager } from '../features/context-fabric/manager'
import { createContextProviderRegistry } from '../features/context-fabric/registry'
import {
  createTextInputSurfaceRegistry,
  type TextInputSurfaceRegistry,
} from '../features/suggest/surface-registry'
import { createEditPredictionContextProvider } from '../features/autocomplete/edit-prediction-context-provider'
import { createCapabilityRegistry } from '../features/ext/capability-registry'
import { createSubsystemRegistry } from '../features/ext/subsystem-contrib'
import { createWsFrameRegistry } from '../features/ext/ws-frame-registry'
import {
  createPreviewLivenessService,
  type PreviewLivenessService,
} from '../features/liveness/preview-liveness'
import { createResourceProviderRegistry } from '../features/agent-core/resource-refs/provider'
import { createVaultResourceProvider } from '../features/secrets/resource-provider'
import type { createSecretsService } from '../features/secrets/service'
import type { createLogger } from '../lib/logger'

export interface RegistriesPhaseInput {
  logger: ReturnType<typeof createLogger>
  secretsService: ReturnType<typeof createSecretsService>
}

export interface RegistriesPhase {
  subsystemRegistry: ReturnType<typeof createSubsystemRegistry>
  contextProviderRegistry: ReturnType<typeof createContextProviderRegistry>
  contextManager: ReturnType<typeof createContextManager>
  textInputSurfaceRegistry: TextInputSurfaceRegistry
  wsFrameRegistry: ReturnType<typeof createWsFrameRegistry>
  capabilityRegistry: ReturnType<typeof createCapabilityRegistry>
  resourceRefsRegistry: ReturnType<typeof createResourceProviderRegistry>
  previewLiveness: PreviewLivenessService
}

export function createRegistriesPhase({
  logger,
  secretsService,
}: RegistriesPhaseInput): RegistriesPhase {
  // Central secrets store — write-only values; `secretsStore` (the resolver) is kept for
  // server-internal resolution, never routed. Routes get list/set/delete only. It is fed
  // to backend plugins as the generic
  // `ctx.host.resolveSecret` seam so they resolve `${secret:KEY}` tokens without importing
  // this subsystem.
  // OPEN subsystem registry — any backend plugin contributes a `BackendSubsystem` (route mount +
  // resource/search providers + shutdown) via its plugin `register()` instead of core
  // hardcoding it. Populated LIVE by the plugin backend host (boot + every hot
  // enable/disable); read by the shutdown handler and diagnostics.
  const subsystemRegistry = createSubsystemRegistry()
  // Destination-aware context contributions are registered independently from
  // resource navigation. Consumers opt into this registry incrementally; simply
  // contributing a provider never injects content into a model request.
  const contextProviderRegistry = createContextProviderRegistry()
  // Core-owned adapter for the Edit Prediction request envelope. It supplies only
  // active-document metadata and same-document history, never arbitrary client data.
  contextProviderRegistry.register({
    provider: createEditPredictionContextProvider(),
    destinations: ['edit-prediction'],
    activation: 'automatic',
    defaultEnabled: true,
    maxTokens: 600,
    timeoutMs: 50,
    sensitivity: 'project',
  })
  const contextManager = createContextManager(contextProviderRegistry)
  // Plugin text fields with ghost-text completion — populated LIVE by the backend host, read per
  // completion call, so enabling a plugin gives its fields completion without a restart.
  const textInputSurfaceRegistry = createTextInputSurfaceRegistry()
  // GENERIC live-stream frame registry — a backend subsystem (bundled plugin)
  // contributes `wsFrames` here (a subscribe/unsubscribe command pair + tagged frame
  // stream); the realtime socket (ws.ts) consults it for otherwise-unrecognized
  // commands.
  const wsFrameRegistry = createWsFrameRegistry()
  // Preview-server liveness is a CORE live stream over that same seam: the pane subscribes
  // to an endpoint instead of polling it from the browser, and the terminal service reports
  // a dev server's exit into the same watcher (see `features/liveness`).
  const previewLiveness = createPreviewLivenessService()
  for (const frame of previewLiveness.frames) {
    const outcome = wsFrameRegistry.register(frame)
    if (outcome.status === 'rejected') {
      logger.warn({ event: 'ws_frame.rejected', reason: outcome.reason, command: outcome.command })
    }
  }
  // Typed plugin→core capability seam from the public SDK: a subsystem may
  // contribute narrow ports core consumes (document extraction, table save, …).
  // First-wins per key; bootstrap resolves the values once and threads them into
  // deps as plain optional ports — core never sees the registry at run time.
  const capabilityRegistry = createCapabilityRegistry((msg) =>
    logger.warn({ event: 'plugin_capability.warn', msg }),
  )
  // Resource-ref provider registry — backs the `@resource:` context-ref kind. Bundled
  // workbench providers (a subsystem tree under `localix://resource/<provider>`) are wired by
  // the plugin backend host below; adding a provider lights up a whole new
  // referenceable tree with no core changes.
  const resourceRefsRegistry = createResourceProviderRegistry()
  const capabilityResourceProvider = createCapabilityResourceProvider()
  resourceRefsRegistry.register(capabilityResourceProvider)
  // Capability links are ordinary explicit resource context. Register their URI
  // owner through the same capture-safe adapter used by other schemes, so chat
  // never branches on plugin/skill/tool/agent/MCP/view and drag grants no authority.
  contextProviderRegistry.register(createCapabilityContextProvider(capabilityResourceProvider))
  resourceRefsRegistry.register(
    createVaultResourceProvider({
      // Spread-forward, not `(userId) => …list(userId)`: a RESTATED signature silently drops
      // any parameter `list` later gains and tsc cannot see it (a 1-param function is
      // assignable to a 2-param type) — this is the form composition-root-contract.test.ts
      // prescribes. Passing the bare method would forward just as opaquely, but `oxlint`'s
      // `unbound-method` flags it: the rule cannot tell that `createSecretsService` returns
      // an object of closures with no `this` to lose.
      listItems: (...args) => secretsService.list(...args),
    }),
  )

  return {
    subsystemRegistry,
    contextProviderRegistry,
    contextManager,
    textInputSurfaceRegistry,
    wsFrameRegistry,
    capabilityRegistry,
    resourceRefsRegistry,
    previewLiveness,
  }
}
