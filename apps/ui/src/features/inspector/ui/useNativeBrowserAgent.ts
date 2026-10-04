import { useEffect, useRef } from 'react'
import { backendClient } from '@/shared/api/client'
import { isDesktop } from '@localixai/kit/environment'
import { previewControlBus } from '@/shared/lib/previewControlBus'
import { tauriInvoke } from '@/shared/lib/tauri'
import type { PreviewsBySession } from '../model/preview'
import { browserEngine } from '../model/browserUrl'
import { decodeEvalResult, ensureNativeProbe } from './nativeProbe'

/**
 * Claim a command once, then drive the exact native tab ID with the shared actuator.
 *
 * The tab is looked up in the strip of the chat that SENT the command: a page belongs to one
 * chat's Browser, and an agent of another chat must not drive it even when it learned its id.
 */
export function useNativeBrowserAgent(tabsBySession: PreviewsBySession): void {
  const inFlight = useRef(new Set<string>())
  useEffect(() => {
    if (!isDesktop) return
    const hostId = crypto.randomUUID()
    return previewControlBus.subscribe((event) => {
      const tab = (tabsBySession[event.sessionId] ?? []).find(
        (entry) => entry.previewId === event.command.previewId && browserEngine(entry) === 'native',
      )
      if (!tab) return
      if (inFlight.current.has(event.commandId)) return
      const invoke = tauriInvoke()
      if (!invoke) return
      inFlight.current.add(event.commandId)
      void (async () => {
        const claimed = await backendClient.previewResult(event.commandId, {
          ok: false,
          claim: true,
          hostId,
        })
        if (!claimed) return
        try {
          await ensureNativeProbe(tab)
          if (
            event.command.action === 'screenshot' &&
            !event.command.ref &&
            !event.command.selector
          ) {
            try {
              const image = await invoke('browser_snapshot', { tabId: tab.previewId })
              await backendClient.previewResult(event.commandId, {
                ok: true,
                hostId,
                result: { action: 'screenshot', previewId: tab.previewId, image },
              })
              return
            } catch (error) {
              if (!String(error).includes('not yet supported on this platform')) throw error
            }
          }
          if (event.command.action === 'viewport' && event.command.viewport) {
            throw new Error('Fixed viewport is not available in a native browser tab')
          }
          const command =
            event.command.action === 'viewport'
              ? {
                  action: 'evaluate',
                  expression: '({width:window.innerWidth,height:window.innerHeight})',
                }
              : event.command
          await invoke('browser_inject', {
            tabId: tab.previewId,
            script: `window.__localixBrowser.run(${JSON.stringify(event.commandId)}, ${JSON.stringify(command)})`,
          })
          for (let attempt = 0; attempt < 100; attempt += 1) {
            const raw = await invoke('browser_eval', {
              tabId: tab.previewId,
              script: `JSON.stringify(window.__localixBrowser?.take(${JSON.stringify(event.commandId)}) ?? null)`,
            })
            const outcome = decodeEvalResult(raw) as {
              ok?: boolean
              result?: Record<string, unknown>
              error?: string
              errorCode?: string
            } | null
            if (outcome && typeof outcome.ok === 'boolean') {
              const viewport =
                event.command.action === 'viewport' && outcome.result?.value
                  ? decodeEvalResult(outcome.result.value)
                  : undefined
              await backendClient.previewResult(event.commandId, {
                ...outcome,
                hostId,
                result:
                  event.command.action === 'viewport'
                    ? { action: 'viewport', previewId: tab.previewId, viewport }
                    : { ...outcome.result, previewId: tab.previewId },
              })
              return
            }
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          throw new Error('Browser page did not answer the command')
        } catch (error) {
          await backendClient.previewResult(event.commandId, {
            ok: false,
            hostId,
            errorCode: 'failed',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })().finally(() => inFlight.current.delete(event.commandId))
    })
  }, [tabsBySession])
}
