import { useEffect, useEffectEvent, useState } from 'react'

import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { useLatestRef } from '@/shared/lib/useLatestRef'
import { sendChatMessage } from '@/entities/chat/model/sendChatMessage'
import { getThemeVars, themeVarsBus } from '@/entities/chat/model/themeVarsBus'
import { miniAppSessionEventBus } from '@/entities/chat/model/miniAppSessionEventBus'
import { createPanelActions } from '@/shared/contrib/miniAppPanelActions'
import { createPanelBridgeHost } from './panelBridgeCore'
import { readMiniAppViewState, writeMiniAppViewState } from './miniAppViewState'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { backendClient } from '@/shared/api/client'

/**
 * React wiring for the host side of the mini-app-panel bridge: subscribes the
 * window `message` listener + the shared theme-vars bus to a
 * {@link createPanelBridgeHost} core bound to THIS panel's iframe. Returns
 * whether the panel opted into the bridge (posted `ready`) — while bridged,
 * theme changes stream over postMessage and the component must NOT remount the
 * iframe on a theme flip; a static panel (never bridged) keeps the legacy
 * snapshot+remount behavior untouched.
 *
 * `resetKey` identifies the current panel document (mini app/panel/reload); a
 * change tears the bridge down and starts fresh for the new iframe.
 */

function currentThemeName(): 'light' | 'dark' {
  return (document.documentElement.dataset.theme ?? 'dark') === 'light' ? 'light' : 'dark'
}

export function useMiniAppPanelBridge({
  miniAppName,
  projectId,
  panelName,
  iframeRef,
  resetKey,
  nonce,
  publishMessageContext,
}: {
  miniAppName: string
  projectId: string
  panelName: string
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  resetKey: string
  /** The bridge nonce baked into the current srcdoc document; null before one is built. */
  nonce: string | null
  publishMessageContext?: PublishMessageContext
}): { bridged: boolean } {
  const [bridged, setBridged] = useState(false)
  // The chat the view's tab belongs to (the grid provides it around every tab body). Read through
  // a ref so the bridge, built once per panel document, always answers with the current one.
  const sessionRef = useLatestRef(useWorkItemSessionId())
  const nonceRef = useLatestRef(nonce)

  // Reset synchronously when the panel document changes (adjust-during-render,
  // same pattern MiniAppPanelTab uses for its error state) so a stale `bridged`
  // can never freeze the NEW document's theme.
  const [prevResetKey, setPrevResetKey] = useState(resetKey)
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey)
    if (bridged) setBridged(false)
  }

  // Which mini app and panel this bridge speaks for is fixed for a panel document: `resetKey`
  // names that document, so a bridge is built per `resetKey` and reads the identity as it is then.
  const readPanel = useEffectEvent(() => ({ miniAppName, projectId, panelName }))

  useEffect(() => {
    const { miniAppName: appName, projectId: project, panelName: panel } = readPanel()
    const core = createPanelBridgeHost({
      getWindow: () => iframeRef.current?.contentWindow,
      getNonce: () => nonceRef.current,
      // Built-ins (ping + sendPrompt with its session guards) available
      // to all, PLUS only THIS mini app's own custom actions — scoped by miniAppName
      // so a view for mini app X cannot invoke mini app Y's actions.
      actions: createPanelActions(
        {
          getSessionId: () => sessionRef.current,
          // The shared send path — instant optimistic paint like the composer;
          // a failure rethrows into the bridge's correlated error reply.
          sendMessage: (sessionId, text) => sendChatMessage(sessionId, text),
          getTheme: () => currentThemeName(),
          readViewState: readMiniAppViewState,
          writeViewState: writeMiniAppViewState,
          publishMessageContext,
          invokeMiniAppBackend: (input) => backendClient.invokeMiniAppUiAction(input),
        },
        appName,
      ),
      context: { miniAppName: appName, projectId: project, panelName: panel },
      onBridged: () => {
        setBridged(true)
        // Sync immediately: the srcDoc embedded a theme snapshot at build time;
        // if the host theme flipped before `ready`, this heals the gap.
        core.postTheme({ theme: currentThemeName(), vars: getThemeVars() })
      },
    })
    const onMessage = (e: MessageEvent) => core.handleMessage(e)
    window.addEventListener('message', onMessage)
    // Live theme streaming — a no-op inside the core until the panel is bridged.
    const unsubscribe = themeVarsBus.subscribe((vars) => {
      core.postTheme({ theme: currentThemeName(), vars })
    })
    // Forward SAFE session lifecycle signals — but ONLY for the chat this view's tab belongs to
    // (the same session `sendPrompt` targets). Another chat's run finishing never reaches this
    // view: per-session isolation lives here, at the subscriber edge.
    const unsubscribeSession = miniAppSessionEventBus.subscribe((event) => {
      if (event.sessionId !== sessionRef.current) return
      core.postSessionEvent(event.sessionId, event.phase)
    })
    return () => {
      publishMessageContext?.(null)
      window.removeEventListener('message', onMessage)
      unsubscribe()
      unsubscribeSession()
    }
  }, [resetKey, publishMessageContext, iframeRef, nonceRef, sessionRef])

  return { bridged }
}
