import { useEffect, useRef } from 'react'
import { backendClient } from '@/shared/api/client'
import { isDesktop } from '@localixai/kit/environment'
import { previewControlBus } from '@/shared/lib/previewControlBus'
import { tauriInvoke } from '@/shared/lib/tauri'
import type { PreviewsBySession } from '../model/preview'
import { browserEngine } from '../model/browserUrl'
import { decodeEvalResult, ensureNativeProbe } from './nativeProbe'
import { drivesPage, navigatedAfter, navigatedResult, runInPage } from './nativeCommand'
import { elementShot } from './nativeShot'

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
          // An element's picture is cut from the WebView's own capture (`nativeShot.ts`).
          if (
            event.command.action === 'screenshot' &&
            (event.command.ref || event.command.selector)
          ) {
            const shot = await elementShot(
              invoke,
              runInPage,
              tab.previewId,
              event.commandId,
              event.command as unknown as Record<string, unknown>,
            )
            if (shot) {
              await backendClient.previewResult(event.commandId, {
                ok: true,
                hostId,
                result: { ...shot, action: 'screenshot', previewId: tab.previewId },
              })
              return
            }
          }
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
          let outcome = await runInPage(invoke, tab.previewId, event.commandId, command)
          if (outcome === 'replaced' && !drivesPage(command.action)) {
            // A read caught by a navigation it did not start reads the page that replaced it.
            await ensureNativeProbe(tab)
            outcome = await runInPage(invoke, tab.previewId, `${event.commandId}:retry`, command)
          }
          let navigated = outcome === 'replaced'
          if (outcome && outcome !== 'replaced' && outcome.ok)
            navigated = await navigatedAfter(invoke, tab.previewId, command.action)
          if (navigated) {
            // The action led to another document: wait for it, and answer with it.
            await ensureNativeProbe(tab)
            const page = await runInPage(invoke, tab.previewId, `${event.commandId}:page`, {
              action: 'snapshot',
            })
            if (!page || page === 'replaced' || !page.ok)
              throw new Error('The page navigated and the new page did not answer')
            const previous = outcome && outcome !== 'replaced' ? outcome.result : undefined
            outcome = {
              ok: true,
              result: navigatedResult(command.action, previous, page.result),
            }
          }
          if (!outcome || outcome === 'replaced')
            throw new Error('Browser page did not answer the command')
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
