/**
 * Mini app UI bridge protocol v1 — the typed postMessage contract between a
 * sandboxed mini app iframe (inspector panel today; bridged views later) and the
 * Localix host window.
 *
 * Design: a versioned envelope `{ lx: 'mini-app-ui', v: 1, type, id?, payload }`.
 * The `lx` marker keeps bridge traffic distinguishable from every other
 * postMessage on the page; `v` lets a future v2 coexist. Message types:
 *
 * - `ready`   iframe → host. Opt-in handshake. A panel that never posts it is a
 *             static document and gets the legacy behavior (theme remount).
 * - `theme`   host → iframe. Live theme update: `{ theme, vars }` where `vars`
 *             are the host's forwarded CSS custom properties. No remount.
 * - `invoke`  iframe → host. `{ action, payload }` plus an envelope `id`; the
 *             host replies with a correlated `result` or `error`.
 * - `result`  host → iframe. Reply to `invoke` with the same `id`.
 * - `error`   host → iframe. Failed reply to `invoke`; payload `{ message }`.
 * - `event`   host → iframe. One-way host push, including the allow-listed
 *             session lifecycle phases described below.
 *
 * Pure types + tiny framework-free helpers, usable verbatim on BOTH sides.
 * Mini app authors bundle their side themselves (inline script or their own
 * build); nothing here depends on React or the DOM libs beyond structural
 * `postMessage` shapes.
 */

/** Envelope marker — fixed discriminator for mini app UI bridge traffic. */
export const MINI_APP_UI_BRIDGE_MARKER = 'mini-app-ui' as const
/** Protocol version this module speaks. */
export const MINI_APP_UI_BRIDGE_VERSION = 1 as const

export type MiniAppBridgeMessageType = 'ready' | 'theme' | 'invoke' | 'result' | 'error' | 'event'

/** The versioned wire envelope. `id` correlates an `invoke` with its reply. */
export interface MiniAppBridgeMessage<P = unknown> {
  lx: typeof MINI_APP_UI_BRIDGE_MARKER
  v: typeof MINI_APP_UI_BRIDGE_VERSION
  type: MiniAppBridgeMessageType
  id?: string
  payload?: P
}

/** `theme` payload — the host theme name plus its forwarded CSS custom properties. */
export interface MiniAppBridgeThemePayload {
  theme: 'light' | 'dark'
  vars: Record<string, string>
}

/** `invoke` payload — a named host action plus its argument. */
export interface MiniAppBridgeInvokePayload {
  action: string
  payload?: unknown
}

/** `error` payload — human-readable failure for a correlated `invoke`. */
export interface MiniAppBridgeErrorPayload {
  message: string
}

/** `event` payload — a one-way host push. */
export interface MiniAppBridgeEventPayload {
  name: string
  data?: unknown
}

/** Options for one host action invoked through the injected mini app UI API. */
export interface MiniAppUiInvokeOptions {
  /** Wall-clock request timeout. The host bootstrap clamps it to 100 ms–2 min. */
  timeoutMs?: number
}

/**
 * Stable, host-injected client available inside every sandboxed mini app panel/view
 * through `acquireLocalixApi()`. It is the ergonomic layer over this file's
 * protocol-v1 envelopes: one frozen
 * instance, explicit opt-in, correlated requests, persisted view state, and live
 * host events without importing application code or reaching the network.
 */
export interface MiniAppUiApi {
  readonly version: typeof MINI_APP_UI_BRIDGE_VERSION
  /** Opt into the live bridge. Idempotent for the acquired instance. */
  ready(): void
  /** Invoke one capability exposed by the host action table. */
  invoke<T = unknown>(
    action: string,
    payload?: unknown,
    options?: MiniAppUiInvokeOptions,
  ): Promise<T>
  /** Call one named operation exposed by this mini app's own backend subsystem. */
  callBackend<T = unknown>(
    action: string,
    payload?: unknown,
    options?: MiniAppUiInvokeOptions,
  ): Promise<T>
  /** Read this mini app+view's persisted JSON scratch state. */
  getState<T = unknown>(): Promise<T | null>
  /** Persist this mini app+view's JSON scratch state and return the accepted value. */
  setState<T>(value: T): Promise<T>
  /** Current host appearance already applied to the iframe document. */
  getTheme(): 'light' | 'dark'
  /** Subscribe to future host theme payloads; returns an unsubscribe function. */
  onTheme(listener: (payload: MiniAppBridgeThemePayload) => void): () => void
  /** Subscribe to safe one-way host events; returns an unsubscribe function. */
  onEvent(listener: (payload: MiniAppBridgeEventPayload) => void): () => void
}

/** Type authors can use for `declare const acquireLocalixApi: AcquireLocalixApi`. */
export type AcquireLocalixApi = () => MiniAppUiApi

// ─── Forwarded session lifecycle events ──────────────────────────────────────

/**
 * The `event` name under which the host forwards SESSION LIFECYCLE signals. A
 * bridged view opts in the same way it opts into theme (post `ready`); it then
 * receives `event` messages named {@link SESSION_EVENT_NAME}, each carrying a
 * {@link MiniAppBridgeSessionEventData}.
 */
export const SESSION_EVENT_NAME = 'session' as const

/** The SAFE, minimal lifecycle phases a bridged view may observe. */
export type MiniAppSessionPhase = 'run-started' | 'run-completed' | 'run-failed'

/**
 * The payload of a forwarded `session` event. Deliberately just the phase + the
 * session id it happened in — NO tool payloads, NO error text, NO message ids,
 * NO secrets. A view uses it as a "the agent started / finished a turn" signal
 * for the session it is contextually in.
 */
export interface MiniAppBridgeSessionEventData {
  phase: MiniAppSessionPhase
  sessionId: string
}

/**
 * The ALLOW-LIST that decides whether an internal host session-stream event type
 * may cross the bridge, and under which safe phase. Anything not listed here is
 * NEVER forwarded — the default is "do not leak". Kept in the SDK so the mapping
 * is typed and unit-testable on both sides.
 *
 * `fs.changed` in particular stays off: it carries absolute paths of the person's
 * files. Native workbench UI hears file changes through `miniAppFiles.watchWorkspace`
 * instead, a door that does not reach a sandboxed view.
 */
const FORWARDABLE_SESSION_EVENTS: Readonly<Record<string, MiniAppSessionPhase>> = {
  'run.started': 'run-started',
  'run.completed': 'run-completed',
  'run.failed': 'run-failed',
}

/** The safe phase an internal event type forwards as, or null when it must not cross. */
export function forwardableSessionPhase(type: string): MiniAppSessionPhase | null {
  return Object.prototype.hasOwnProperty.call(FORWARDABLE_SESSION_EVENTS, type)
    ? FORWARDABLE_SESSION_EVENTS[type]
    : null
}

/** Structural guard for a forwarded `session`-event payload (for the mini app side + tests). */
export function isSessionEventData(data: unknown): data is MiniAppBridgeSessionEventData {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return (
    typeof d.sessionId === 'string' &&
    (d.phase === 'run-started' || d.phase === 'run-completed' || d.phase === 'run-failed')
  )
}

// ─── Guards ──────────────────────────────────────────────────────────────────

const MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'ready',
  'theme',
  'invoke',
  'result',
  'error',
  'event',
])

/** Structural guard for the v1 envelope. Anything else on the wire is ignored. */
export function isMiniAppBridgeMessage(data: unknown): data is MiniAppBridgeMessage {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  if (d.lx !== MINI_APP_UI_BRIDGE_MARKER || d.v !== MINI_APP_UI_BRIDGE_VERSION) return false
  if (typeof d.type !== 'string' || !MESSAGE_TYPES.has(d.type)) return false
  if ('id' in d && d.id !== undefined && typeof d.id !== 'string') return false
  return true
}

/** Guard for a well-formed `invoke` payload on an already-validated envelope. */
export function isInvokePayload(payload: unknown): payload is MiniAppBridgeInvokePayload {
  if (typeof payload !== 'object' || payload === null) return false
  const p = payload as Record<string, unknown>
  return typeof p.action === 'string' && p.action.length > 0
}

/**
 * Anti-spoof gate for an inbound bridge postMessage: trust it ONLY when it
 * comes from the expected live window. FAIL CLOSED when there is no live
 * window — nothing can legitimately originate from a missing frame.
 * `source`/`win` are structurally typed so both sides (and tests) can pass
 * whatever their environment calls a window.
 */
export function isMessageFromWindow(win: unknown, source: unknown): boolean {
  return win !== null && win !== undefined && source === win
}

// ─── Constructors ────────────────────────────────────────────────────────────

function envelope<P>(type: MiniAppBridgeMessageType, payload?: P, id?: string) {
  const msg: MiniAppBridgeMessage<P> = {
    lx: MINI_APP_UI_BRIDGE_MARKER,
    v: MINI_APP_UI_BRIDGE_VERSION,
    type,
  }
  if (id !== undefined) msg.id = id
  if (payload !== undefined) msg.payload = payload
  return msg
}

export const readyMessage = () => envelope('ready')
export const themeMessage = (payload: MiniAppBridgeThemePayload) => envelope('theme', payload)
export const invokeMessage = (id: string, action: string, payload?: unknown) =>
  envelope<MiniAppBridgeInvokePayload>('invoke', { action, payload }, id)
export const resultMessage = (id: string, value: unknown) => envelope('result', value, id)
export const errorMessage = (id: string, message: string) =>
  envelope<MiniAppBridgeErrorPayload>('error', { message }, id)
export const eventMessage = (name: string, data?: unknown) =>
  envelope<MiniAppBridgeEventPayload>('event', { name, data })
export const sessionEventMessage = (sessionId: string, phase: MiniAppSessionPhase) =>
  eventMessage(SESSION_EVENT_NAME, { phase, sessionId } satisfies MiniAppBridgeSessionEventData)

export { createBridgeRequests, type BridgeRequests } from './bridge-requests'
