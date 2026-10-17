import type { MiddlewareHandler } from 'hono'
import type { BackendSubsystem, SubsystemRegistry } from '../ext/subsystem-contrib'
import type { CapabilityRegistry } from '../ext/capability-registry'
import type { WsFrameRegistry } from '../ext/ws-frame-registry'
import type { ResourceProviderRegistry } from '../agent-core/resource-refs/provider'
import type { SearchProviderRegistry } from '../agent-core/search/provider'
import type { ContextProviderRegistry } from '../context-fabric/registry'
import type { TextInputSurfaceRegistry } from '../suggest/surface-registry'
import type { PluginRouteScope } from '@localixai/plugin-sdk/backend'
import type { PluginConditions } from '../notifications/conditions/plugins'
import type { PluginUiActionCall } from './backend-host-ui-actions'

export interface PluginBackendHostDeps {
  /** Thunk over `loadPluginBackends` — the desired (enabled) set, freshly loaded. */
  loadBackends: () => Promise<
    Array<{
      pluginName: string
      projectId?: string
      backend: BackendSubsystem
      /** Identity of the code it came from; a changed revision re-wires the plugin. */
      revision?: string
    }>
  >
  subsystemRegistry: SubsystemRegistry
  capabilityRegistry: CapabilityRegistry
  wsFrameRegistry: WsFrameRegistry
  resourceRefsRegistry: ResourceProviderRegistry
  contextProviderRegistry: ContextProviderRegistry
  /** Plugin text fields with ghost-text completion, side by side (absent in a leaner host). */
  textInputSurfaceRegistry?: TextInputSurfaceRegistry
  /** Called after a reconcile settles (state actually changed on toggle paths) —
   *  bootstrap publishes the `resources.changed` stream event through it, so the UI
   *  never refetches a state whose routes are still half-wired. */
  onSettled?: () => void
  /**
   * WHERE a plugin route call is happening — resolved per request, never captured at load.
   *
   * A backend is wired ONCE per plugin (see the host’s `wired.has(pluginName)` guard), so the cwd
   * it was loaded with is whichever project happened to come first. A plugin that keeps state in
   * the workspace needs the CURRENT one, which only the request can say. Absent in a leaner host:
   * the plugin app then receives no environment and falls back to whatever it captured.
   */
  resolveScope?: (input: {
    userId: string
    request: Request
  }) => Promise<PluginRouteScope> | PluginRouteScope
  /** Where a rejected backend or a failed reconcile becomes a standing Event Center row. */
  conditions?: Pick<PluginConditions, 'backendProblems' | 'reconciled'>
  logger?: {
    info?: (msg: string) => void
    warn: (msg: string, meta?: unknown) => void
  }
}

export interface PluginBackendHost {
  /** The stable route dispatcher — mount ONCE where the static subsystem
   *  `app.route()` loop used to sit (before the `/rpc` chat catch-all). */
  middleware(): MiddlewareHandler
  /** Debounced, serialized reconcile — the `onChanged` hook for plugin toggles. */
  refresh(): void
  /** Recompute desired vs wired and converge. Exposed for boot + tests. */
  reconcile(): Promise<void>
  /** The search registry is composed AFTER boot's first reconcile (boot/search.ts);
   *  setting it registers the already-wired subsystems' search providers. */
  setSearchRegistry(registry: SearchProviderRegistry): void
  /** Invoke one operation owned by an enabled plugin's sandboxed UI. */
  invokeUiAction(input: PluginUiActionCall): Promise<unknown>
  /** Currently wired plugin names (diagnostics/tests). */
  wired(): string[]
  /**
   * Server shutdown: wait out the reconcile in flight and refuse every later one, so a boot
   * reconcile that loses the race to `stop` never wires, logs or reports after teardown. Wired
   * subsystems are torn down by the shutdown's `onShutdown` sweep, not here.
   */
  stop(): Promise<void>
}
