import type { Hono, Schema } from 'hono'
import type { Capabilities } from './capabilities'
import type { ContextProviderContribution } from './context-fabric'
import type { ResourceRefProvider } from './resource-refs'
import type { SearchProvider } from './search-provider'
import type { MiniAppTextInputCompletionSurface } from './text-input-completion-port'
import type { WsFrameContribution } from './ws-frame-registry'
import type { MiniAppRouteContext } from './http'

/** Host-bound scope for a sandboxed view calling its owning mini app backend. */
export interface MiniAppUiActionContext {
  userId: string
  projectId: string
  cwd: string
  /** Active chat session when the surface has one. */
  sessionId?: string
  /** Manifest panel/view id that initiated the call. */
  viewId: string
}

/** A JSON request/reply operation exposed only to this mini app's own UI. */
export type MiniAppUiActionHandler = (payload: unknown, context: MiniAppUiActionContext) => unknown

/**
 * Open backend contribution contract. The host composes these building blocks
 * generically; neither side needs a case for a concrete mini app.
 */
export interface BackendSubsystem {
  id: string
  routeMount?: { path: string; app: Hono<MiniAppRouteContext, Schema, string> }
  /**
   * Named operations for sandboxed panels/views owned by the SAME mini app.
   * The host brokers identity and request scope; mini app HTML never chooses the
   * target mini app and never needs direct network access.
   */
  uiActions?: Record<string, MiniAppUiActionHandler>
  resourceProvider?: ResourceRefProvider
  searchProvider?: SearchProvider
  contextProviders?: ContextProviderContribution[]
  /**
   * Text fields this mini app owns that get ghost-text completion. Every mini app may declare its
   * own, side by side; each id must be namespaced by the mini app's name (`<app>.<field>`).
   */
  textInputCompletionSurfaces?: MiniAppTextInputCompletionSurface[]
  wsFrames?: WsFrameContribution[]
  capabilities?: Capabilities
  onShutdown?: () => void | Promise<void>
}
