import { useEffect } from 'react'
import { backendClient } from '@/shared/api/client'
import { previewControlBus, type PreviewCommandEvent } from '@/shared/lib/previewControlBus'
import { workspaceOf } from '@/shared/lib/workspaceOf'
import { usePreviewStore } from '../model/previewStore'
import type { PreviewEntry } from '../model/preview'

/** Long enough for a real host to mount off screen and claim; far below the relay timeout. */
export const UNKNOWN_TAB_GRACE_MS = 3_000

function tabsOf(sessionId: string): PreviewEntry[] {
  return usePreviewStore.getState().previewTabsBySession[workspaceOf(sessionId)] ?? []
}

/** Whether no host in this window could ever answer the command: it names a tab not in its strip. */
export function namesUnknownTab(event: PreviewCommandEvent): boolean {
  const id = event.command.previewId
  if (!id || event.command.action === 'history' || id.startsWith('mini-app:')) return false
  return !tabsOf(event.sessionId).some((tab) => tab.previewId === id)
}

/** The reply for a tab ID nothing hosts: which tabs ARE open, so the agent can pick one. */
export function unknownTabMessage(previewId: string, tabs: PreviewEntry[]): string {
  const open = tabs.slice(0, 20).map((tab) => `${tab.previewId} — ${tab.url}`)
  return `No open Browser tab has ID "${previewId}". ${
    open.length ? `Open tabs: ${open.join('; ')}.` : 'No Browser tabs are open.'
  } Use one of these IDs, or open the page with action="open".`
}

/**
 * Answer a command for a tab ID that no Browser tab carries (a mistyped or invented ID) with the
 * open tabs, instead of letting it wait out the relay and come back as "host unavailable". It
 * claims like any host, after a grace period, so a real host that is still mounting wins.
 */
export function useUnknownTabReply(graceMs = UNKNOWN_TAB_GRACE_MS): void {
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const unsubscribe = previewControlBus.subscribe((event) => {
      if (!namesUnknownTab(event)) return
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (!namesUnknownTab(event)) return
        const hostId = `unknown-tab:${crypto.randomUUID()}`
        void (async () => {
          const claimed = await backendClient.previewResult(event.commandId, {
            ok: false,
            claim: true,
            hostId,
          })
          if (!claimed) return
          previewControlBus.acknowledge(event.commandId)
          await backendClient.previewResult(event.commandId, {
            ok: false,
            hostId,
            errorCode: 'not_found',
            error: unknownTabMessage(event.command.previewId!, tabsOf(event.sessionId)),
          })
        })().catch(() => {})
      }, graceMs)
      timers.add(timer)
    })
    return () => {
      unsubscribe()
      for (const timer of timers) clearTimeout(timer)
    }
  }, [graceMs])
}
