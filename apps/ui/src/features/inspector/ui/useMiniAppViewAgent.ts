import { useEffect } from 'react'
import { parsePluginViewTarget } from '@localixai/api/plugin-view-target'
import { useChatStore } from '@/entities/chat/model/store'
import { backendClient } from '@/shared/api/client'
import { previewControlBus } from '@/shared/lib/previewControlBus'
import { runPluginViewCommand } from '../model/miniAppViewHost'

/**
 * Answer the agent's `browser` commands for `plugin:<name>` targets from this window's workbench.
 *
 * Same relay contract as every other Browser host (`useNativeBrowserAgent`): claim the command
 * first, so a second window — or a remount — can never run the same click twice, then execute it
 * and reply once. The execution itself is `miniAppViewHost.ts`; this hook only owns the claim and
 * the reply.
 */
export function useMiniAppViewAgent(): void {
  useEffect(() => {
    const hostId = crypto.randomUUID()
    const inFlight = new Set<string>()
    return previewControlBus.subscribe((event) => {
      const plugin = parsePluginViewTarget(event.command.previewId)
      if (!plugin || inFlight.has(event.commandId)) return
      inFlight.add(event.commandId)
      const respond = (payload: Record<string, unknown>) =>
        backendClient.previewResult(event.commandId, { ...payload, hostId })
      void (async () => {
        if (!(await respond({ ok: false, claim: true }))) return
        previewControlBus.acknowledge(event.commandId)
        const reply = await runPluginViewCommand(plugin, event.command, {
          sessionId: event.sessionId,
          activeSessionId: useChatStore.getState().activeSessionId,
        })
        await respond({
          ...reply,
          ...(reply.result
            ? { result: { ...reply.result, previewId: event.command.previewId } }
            : {}),
        })
      })()
        .catch((error: unknown) =>
          respond({
            ok: false,
            errorCode: 'failed',
            error: error instanceof Error ? error.message : String(error),
          }).catch(() => {}),
        )
        .finally(() => inFlight.delete(event.commandId))
    })
  }, [])
}
