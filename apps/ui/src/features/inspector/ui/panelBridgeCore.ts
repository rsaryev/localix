import {
  errorMessage,
  isInvokePayload,
  isMessageFromWindow,
  isMiniAppBridgeMessage,
  resultMessage,
  sessionEventMessage,
  themeMessage,
  type MiniAppBridgeThemePayload,
  type MiniAppSessionPhase,
} from '@localixai/mini-app-sdk/ui'

import type { PanelActionContext, PanelActionTable } from '@/shared/contrib/miniAppPanelActions'

/**
 * Framework-free HOST side of the mini-app-panel bridge (protocol:
 * mini-app-sdk/ui/bridge). One instance per mounted panel iframe. The React hook
 * (useMiniAppPanelBridge) owns lifecycles and DOM listeners; this core owns the
 * protocol so it is testable with fake windows:
 *
 * - validates every inbound message (envelope guard + fail-closed source
 *   check against the LIVE iframe window + the srcdoc document's nonce),
 * - flips `bridged` on the panel's `ready` opt-in (a static panel that never
 *   posts it keeps the legacy remount behavior — the caller checks
 *   `isBridged()`),
 * - dispatches `invoke` through the capability-limited action table and posts
 *   the correlated `result`/`error` reply,
 * - streams `theme` updates (no-op until bridged — a static document has no
 *   listener, the host remounts it instead).
 */

/** The subset of Window the core touches — lets tests pass a plain object. */
export interface PanelWindowLike {
  postMessage(message: unknown, targetOrigin: string): void
}

export interface PanelBridgeHostOptions {
  /** The panel iframe's LIVE contentWindow; null when unmounted. */
  getWindow: () => PanelWindowLike | null | undefined
  actions: PanelActionTable
  context: PanelActionContext
  /** Fired once, when the panel posts `ready` (opts into the bridge). */
  onBridged?: () => void
  /**
   * The nonce `buildPanelSrcDoc` baked into the CURRENT srcdoc document's bootstrap; null when
   * none is loaded. The window check alone is not enough: a frame keeps its WindowProxy when it
   * navigates, so a page the view links to would otherwise inherit `sendPrompt`/`callBackend`.
   */
  getNonce: () => string | null | undefined
}

export interface PanelBridgeHost {
  /** Feed a window `message` event (structurally typed for tests). */
  handleMessage(event: { data: unknown; source: unknown }): void
  /** Stream a live theme update into a BRIDGED panel (no-op otherwise). */
  postTheme(payload: MiniAppBridgeThemePayload): void
  /**
   * Forward a SAFE session lifecycle signal into a BRIDGED panel (no-op until
   * bridged). Only the phase + session id cross — no tool I/O, no secrets. The
   * caller is responsible for the per-session gate (only THIS view's session).
   */
  postSessionEvent(sessionId: string, phase: MiniAppSessionPhase): void
  isBridged(): boolean
}

export function createPanelBridgeHost(options: PanelBridgeHostOptions): PanelBridgeHost {
  const { getWindow, actions, context, onBridged, getNonce } = options
  let bridged = false

  function post(message: unknown): void {
    getWindow()?.postMessage(message, '*')
  }

  function dispatchInvoke(id: string | undefined, action: string, payload: unknown): void {
    const handler = actions.get(action)
    // Run through a resolved promise so a synchronously-throwing handler still
    // lands in the error reply instead of escaping the message listener.
    void Promise.resolve()
      .then(() => {
        if (!handler) throw new Error(`Unknown action "${action}"`)
        return handler(payload, context)
      })
      .then(
        (value) => {
          if (id !== undefined) post(resultMessage(id, value))
        },
        (err: unknown) => {
          if (id !== undefined) {
            post(errorMessage(id, err instanceof Error ? err.message : String(err)))
          }
        },
      )
  }

  return {
    handleMessage(event) {
      if (!isMiniAppBridgeMessage(event.data)) return
      // Trust only THIS panel's live iframe — fail closed when it is unmounted.
      if (!isMessageFromWindow(getWindow(), event.source)) return
      // ...and only the document the host built for it. Fail closed without a nonce.
      const nonce = getNonce()
      if (!nonce || (event.data as { nonce?: unknown }).nonce !== nonce) return
      const message = event.data
      if (message.type === 'ready') {
        if (!bridged) {
          bridged = true
          onBridged?.()
        }
        return
      }
      if (message.type === 'invoke' && isInvokePayload(message.payload)) {
        dispatchInvoke(message.id, message.payload.action, message.payload.payload)
      }
      // 'theme' | 'result' | 'error' | 'event' are host→iframe; ignore inbound.
    },
    postTheme(payload) {
      if (!bridged) return
      post(themeMessage(payload))
    },
    postSessionEvent(sessionId, phase) {
      if (!bridged) return
      post(sessionEventMessage(sessionId, phase))
    },
    isBridged: () => bridged,
  }
}
