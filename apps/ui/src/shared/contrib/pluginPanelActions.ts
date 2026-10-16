/**
 * Capability-limited actions a bridged plugin panel/view may `invoke`.
 *
 * Deliberately a small registry (not a switch god-file). Two BUILT-INS —
 * `ping` (echo, for tests/liveness) and `sendPrompt` (same semantics as the
 * inline-widget bridge) — are available to EVERY plugin. Custom actions are
 * registered PER PLUGIN via {@link registerPanelAction} and namespaced by the
 * owning plugin: {@link createPanelActions} builds a table for ONE plugin, so a
 * bridged view for plugin X can only invoke X's own custom actions plus the
 * built-ins — never plugin Y's. Everything here is pure: the host dependencies
 * (chat session lookup, message send) are injected, so the table is
 * unit-testable without the backend client or the chat store.
 */
import {
  normalizePublishedMessageContext,
  type PublishMessageContext,
} from '@localixai/plugin-sdk/ui'

export interface PanelActionContext {
  pluginName: string
  projectId: string
  panelName: string
}

/** May return a value or a promise — the bridge awaits either before replying. */
export type PanelActionHandler = (payload: unknown, ctx: PanelActionContext) => unknown

export type PanelActionTable = ReadonlyMap<string, PanelActionHandler>

/** Host capabilities the built-in actions need — injected for testability. */
export interface PanelActionDeps {
  /** The chat the view's tab belongs to — where a prompt lands and what `getContext` reports;
   *  null for a view that belongs to none. Never the chat on screen: a view kept warm in chat A
   *  used to send its prompt into chat B once B was the one open. */
  getSessionId(): string | null
  /** Send a user prompt into a session (the widget-bridge `sendPrompt` path). */
  sendMessage(sessionId: string, text: string): Promise<unknown>
  /** The current host theme — surfaced through `getContext` (no secret). */
  getTheme?(): 'light' | 'dark'
  /** Read this view's persisted scratch state (scope = `${plugin}\x00${view}`). */
  readViewState?(scope: string): unknown
  /** Persist this view's scratch state. May throw (e.g. oversized) → error reply. */
  writeViewState?(scope: string, value: unknown): void
  /** Publish context for this sandboxed view's owning editor tab. */
  publishMessageContext?: PublishMessageContext
  /** Broker a call to this view's owning native backend contribution. */
  invokePluginBackend?(input: {
    pluginName: string
    projectId: string
    viewId: string
    sessionId: string | null
    action: string
    payload: unknown
  }): Promise<unknown>
}

/** Per-view state scope — embeds the plugin name so cross-plugin reads are impossible. */
function viewStateScope(ctx: PanelActionContext): string {
  return `${ctx.pluginName}\x00${ctx.panelName}`
}

/** Per-plugin custom action registries — `pluginName → (action → handler)`. */
const registered = new Map<string, Map<string, PanelActionHandler>>()

/**
 * Register a custom host action for ONE plugin. Scoped by `pluginName` so it is
 * only ever reachable from that plugin's own bridged views (per-plugin authz).
 * Last write wins for a given `(plugin, name)`.
 */
export function registerPanelAction(
  pluginName: string,
  name: string,
  handler: PanelActionHandler,
): void {
  let table = registered.get(pluginName)
  if (!table) {
    table = new Map()
    registered.set(pluginName, table)
  }
  table.set(name, handler)
}

/** Drop every custom action registered for a plugin (e.g. on disable/uninstall). */
export function clearPanelActions(pluginName: string): void {
  registered.delete(pluginName)
}

/**
 * Build the action table for ONE plugin: built-ins over `deps`, plus ONLY the
 * custom actions registered for `pluginName`. Built-ins win a name collision —
 * a plugin must not be able to shadow `sendPrompt` with its own handler — and a
 * plugin never sees another plugin's custom actions.
 */
export function createPanelActions(deps: PanelActionDeps, pluginName?: string): PanelActionTable {
  const table = new Map<string, PanelActionHandler>(
    pluginName ? (registered.get(pluginName) ?? new Map()) : new Map(),
  )

  // Echo — lets a panel (and our tests) verify the bridge round-trip.
  table.set('ping', (payload) => payload ?? 'pong')

  // Same guards as the widget bridge's sendPrompt: a non-empty trimmed text and
  // a live session. With a correlated reply available we surface the "no
  // session" case as an error instead of the widget's silent drop.
  table.set('sendPrompt', async (payload) => {
    // Accept `{ text }` (canonical) or a bare string; anything else is empty.
    const candidate =
      typeof payload === 'string' ? payload : (payload as { text?: unknown } | null)?.text
    const trimmed = typeof candidate === 'string' ? candidate.trim() : ''
    if (!trimmed) throw new Error('sendPrompt needs a non-empty "text"')
    const sessionId = deps.getSessionId()
    if (!sessionId) throw new Error('This view belongs to no chat session to send the prompt to')
    await deps.sendMessage(sessionId, trimmed)
    return { sent: true }
  })

  // Read-only context — the current session id + theme, plus this view's identity.
  // No secrets, no tool I/O; a view uses it to render "which session am I in".
  table.set('getContext', (_payload, ctx) => ({
    sessionId: deps.getSessionId(),
    theme: deps.getTheme?.() ?? 'dark',
    plugin: ctx.pluginName,
    projectId: ctx.projectId,
    view: ctx.panelName,
  }))

  // The iframe cannot choose a target plugin or scope: both are taken from the
  // mounted surface context. It only names one operation its own backend exposed.
  table.set('callBackend', async (payload, ctx) => {
    const request = payload as { action?: unknown; payload?: unknown } | null
    const action = typeof request?.action === 'string' ? request.action.trim() : ''
    if (!/^[a-z][a-z0-9._-]{0,63}$/i.test(action)) {
      throw new Error('callBackend needs a valid non-empty "action"')
    }
    if (!deps.invokePluginBackend) throw new Error('Plugin backend actions are unavailable')
    return deps.invokePluginBackend({
      pluginName: ctx.pluginName,
      projectId: ctx.projectId,
      viewId: ctx.panelName,
      sessionId: deps.getSessionId(),
      action,
      payload: request?.payload,
    })
  })

  // Per-view persisted scratch — survives a remount so a view keeps its own state
  // (scroll position, a draft, a selected tab) without a backend. Scoped by
  // plugin+view: a view can only ever touch its OWN slot.
  table.set('getViewState', (_payload, ctx) => deps.readViewState?.(viewStateScope(ctx)) ?? null)
  table.set('setViewState', (payload, ctx) => {
    deps.writeViewState?.(viewStateScope(ctx), payload)
    return { saved: true }
  })

  // Sandboxed views use the same central live-context contract as bundled React
  // contributions. The SDK validator clamps content, bounds facet count and
  // forces `source: plugin`; the iframe cannot spoof active-tab provenance.
  table.set('publishMessageContext', (payload) => {
    if (!deps.publishMessageContext) {
      throw new Error('Live message context is not available on this plugin surface')
    }
    if (payload === null) {
      deps.publishMessageContext(null)
      return { published: false }
    }
    const context = normalizePublishedMessageContext(payload)
    if (!context) throw new Error('Invalid live message context publication')
    deps.publishMessageContext(context)
    return { published: true, bindings: context.bindings.length }
  })

  return table
}
