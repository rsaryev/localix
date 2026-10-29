/**
 * Capability-limited actions a bridged mini app panel/view may `invoke`.
 *
 * Deliberately a small registry (not a switch god-file). Two BUILT-INS —
 * `ping` (echo, for tests/liveness) and `sendPrompt` (same semantics as the
 * inline-widget bridge) — are available to EVERY mini app. Custom actions are
 * registered PER MINI APP via {@link registerPanelAction} and namespaced by the
 * owning mini app: {@link createPanelActions} builds a table for ONE mini app, so a
 * bridged view for mini app X can only invoke X's own custom actions plus the
 * built-ins — never mini app Y's. Everything here is pure: the host dependencies
 * (chat session lookup, message send) are injected, so the table is
 * unit-testable without the backend client or the chat store.
 */
import {
  normalizePublishedMessageContext,
  type PublishMessageContext,
} from '@localixai/mini-app-sdk/ui'

export interface PanelActionContext {
  miniAppName: string
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
  /** Read this view's persisted scratch state (scope = `${miniApp}\x00${view}`). */
  readViewState?(scope: string): unknown
  /** Persist this view's scratch state. May throw (e.g. oversized) → error reply. */
  writeViewState?(scope: string, value: unknown): void
  /** Publish context for this sandboxed view's owning editor tab. */
  publishMessageContext?: PublishMessageContext
  /** Broker a call to this view's owning native backend contribution. */
  invokeMiniAppBackend?(input: {
    app: string
    projectId: string
    viewId: string
    sessionId: string | null
    action: string
    payload: unknown
  }): Promise<unknown>
}

/** Per-view state scope — embeds the mini app name so cross-mini-app reads are impossible. */
function viewStateScope(ctx: PanelActionContext): string {
  return `${ctx.miniAppName}\x00${ctx.panelName}`
}

/** Per-mini-app custom action registries — `miniAppName → (action → handler)`. */
const registered = new Map<string, Map<string, PanelActionHandler>>()

/**
 * Register a custom host action for ONE mini app. Scoped by `miniAppName` so it is
 * only ever reachable from that mini app's own bridged views (per-mini-app authz).
 * Last write wins for a given `(mini app, name)`.
 */
export function registerPanelAction(
  miniAppName: string,
  name: string,
  handler: PanelActionHandler,
): void {
  let table = registered.get(miniAppName)
  if (!table) {
    table = new Map()
    registered.set(miniAppName, table)
  }
  table.set(name, handler)
}

/** Drop every custom action registered for a mini app (e.g. on disable/uninstall). */
export function clearPanelActions(miniAppName: string): void {
  registered.delete(miniAppName)
}

/**
 * Build the action table for ONE mini app: built-ins over `deps`, plus ONLY the
 * custom actions registered for `miniAppName`. Built-ins win a name collision —
 * a mini app must not be able to shadow `sendPrompt` with its own handler — and a
 * mini app never sees another mini app's custom actions.
 */
export function createPanelActions(deps: PanelActionDeps, miniAppName?: string): PanelActionTable {
  const table = new Map<string, PanelActionHandler>(
    miniAppName ? (registered.get(miniAppName) ?? new Map()) : new Map(),
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
    miniApp: ctx.miniAppName,
    projectId: ctx.projectId,
    view: ctx.panelName,
  }))

  // The iframe cannot choose a target mini app or scope: both are taken from the
  // mounted surface context. It only names one operation its own backend exposed.
  table.set('callBackend', async (payload, ctx) => {
    const request = payload as { action?: unknown; payload?: unknown } | null
    const action = typeof request?.action === 'string' ? request.action.trim() : ''
    if (!/^[a-z][a-z0-9._-]{0,63}$/i.test(action)) {
      throw new Error('callBackend needs a valid non-empty "action"')
    }
    if (!deps.invokeMiniAppBackend) throw new Error('Mini app backend actions are unavailable')
    return deps.invokeMiniAppBackend({
      app: ctx.miniAppName,
      projectId: ctx.projectId,
      viewId: ctx.panelName,
      sessionId: deps.getSessionId(),
      action,
      payload: request?.payload,
    })
  })

  // Per-view persisted scratch — survives a remount so a view keeps its own state
  // (scroll position, a draft, a selected tab) without a backend. Scoped by
  // mini app+view: a view can only ever touch its OWN slot.
  table.set('getViewState', (_payload, ctx) => deps.readViewState?.(viewStateScope(ctx)) ?? null)
  table.set('setViewState', (payload, ctx) => {
    deps.writeViewState?.(viewStateScope(ctx), payload)
    return { saved: true }
  })

  // Sandboxed views use the same central live-context contract as native React
  // contributions. The SDK validator clamps content, bounds facet count and
  // forces `source: mini-app`; the iframe cannot spoof active-tab provenance.
  table.set('publishMessageContext', (payload) => {
    if (!deps.publishMessageContext) {
      throw new Error('Live message context is not available on this mini app surface')
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
