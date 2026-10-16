import { useEffect, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import { autoReveal } from '@/shared/lib/inspectorBus'
import { previewControlBus } from '@/shared/lib/previewControlBus'
import { useChatStore } from '@/features/chat/model/store'
import { useBrowserHistory } from '../model/browserHistory'
import { BROWSER_HISTORY_URL } from '../model/browserUrl'
import { usePreviewStore } from '../model/previewStore'
import type { PreviewCommand } from '@/shared/api/contracts'

/** Run one agent history command for `sessionId`, the chat that sent it. The visits are the
 *  person's (app-wide, see `browserHistory.ts`); the History TAB opens in that chat's Browser. */
export function runHistoryCommand(sessionId: string, command: PreviewCommand): string {
  const store = useBrowserHistory.getState()
  const operation = command.historyOperation
  if (operation === 'open') {
    const tabId = usePreviewStore.getState().openBrowserHistory(sessionId)
    return JSON.stringify({ tab_id: tabId, opened: true })
  }
  if (operation === 'remove') {
    const removed = store.remove(command.historyUrls ?? [])
    return JSON.stringify({ removed, total: useBrowserHistory.getState().visits.length })
  }
  if (operation === 'clear') {
    const removed = store.visits.length
    store.clear()
    return JSON.stringify({ removed, total: 0 })
  }
  if (operation === 'list' || operation === 'search') {
    const query = operation === 'search' ? (command.historyQuery ?? '').trim().toLowerCase() : ''
    const matching = query
      ? store.visits.filter(
          (visit) =>
            visit.url.toLowerCase().includes(query) || visit.title?.toLowerCase().includes(query),
        )
      : store.visits
    return JSON.stringify({
      total: matching.length,
      entries: matching.slice(0, 20),
    })
  }
  throw new Error('Unknown Browser history operation')
}

/** One app-wide relay host; website WebViews never see Browser history data. */
export function useBrowserHistoryAgent(): void {
  const [hostId] = useState(() => crypto.randomUUID())
  useEffect(() => {
    const inFlight = new Set<string>()
    return previewControlBus.subscribe((event) => {
      if (event.command.action !== 'history' || inFlight.has(event.commandId)) return
      inFlight.add(event.commandId)
      void (async () => {
        const claimed = await backendClient.previewResult(event.commandId, {
          ok: false,
          claim: true,
          hostId,
        })
        if (!claimed) return
        previewControlBus.acknowledge(event.commandId)
        try {
          const value = runHistoryCommand(event.sessionId, event.command)
          if (
            event.command.historyOperation === 'open' &&
            useChatStore.getState().activeSessionId === event.sessionId
          ) {
            const opened = JSON.parse(value) as { tab_id: string }
            autoReveal(
              {
                kind: 'preview',
                url: BROWSER_HISTORY_URL,
                title: 'History',
                version: 0,
                sessionId: event.sessionId,
                previewId: opened.tab_id,
              },
              { important: true },
            )
          }
          await backendClient.previewResult(event.commandId, {
            ok: true,
            hostId,
            result: { action: 'history', value },
          })
        } catch (error) {
          await backendClient.previewResult(event.commandId, {
            ok: false,
            hostId,
            errorCode: 'failed',
            error: error instanceof Error ? error.message : 'Browser history command failed',
          })
        }
      })().finally(() => inFlight.delete(event.commandId))
    })
  }, [hostId])
}
