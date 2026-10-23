import type { Hono, Schema } from 'hono'
import type { Capabilities } from './capabilities'
import type { ContextProviderContribution } from './context-fabric'
import type { ResourceRefProvider } from './resource-refs'
import type { SearchProvider } from './search-provider'
import type { PluginTextInputCompletionSurface } from './text-input-completion-port'
import type { WsFrameContribution } from './ws-frame-registry'
import type { PluginRouteContext } from './http'

/** Host-bound scope for a sandboxed view calling its owning plugin backend. */
export interface PluginUiActionContext {
  userId: string
  projectId: string
  cwd: string
  /** Active chat session when the surface has one. */
  sessionId?: string
  /** Manifest panel/view id that initiated the call. */
  viewId: string
}

/** A JSON request/reply operation exposed only to this plugin's own UI. */
export type PluginUiActionHandler = (payload: unknown, context: PluginUiActionContext) => unknown

/**
 * Open backend contribution contract. The host composes these building blocks
 * generically; neither side needs a case for a concrete plugin.
 */
export interface BackendSubsystem {
  id: string
  routeMount?: { path: string; app: Hono<PluginRouteContext, Schema, string> }
  /**
   * Named operations for sandboxed panels/views owned by the SAME plugin.
   * The host brokers identity and request scope; plugin HTML never chooses the
   * target plugin and never needs direct network access.
   */
  uiActions?: Record<string, PluginUiActionHandler>
  resourceProvider?: ResourceRefProvider
  searchProvider?: SearchProvider
  contextProviders?: ContextProviderContribution[]
  /**
   * Text fields this plugin owns that get ghost-text completion. Every plugin may declare its own,
   * side by side; each id must be namespaced by the plugin's name (`<plugin>.<field>`).
   */
  textInputCompletionSurfaces?: PluginTextInputCompletionSurface[]
  wsFrames?: WsFrameContribution[]
  capabilities?: Capabilities
  onShutdown?: () => void | Promise<void>
}
