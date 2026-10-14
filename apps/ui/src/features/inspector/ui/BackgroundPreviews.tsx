import { useEffect } from 'react'
import { eventSocket } from '@/shared/api/eventSocket'
import { isDesktop } from '@localixai/kit/environment'
import { routePreviewCommand, routePreviewUpdated } from '@/features/chat/model/sessionEventRouters'
import { usePreviewStore } from '../model/previewStore'
import { previewHostKey, usePreviewHosts } from '../model/previewHosts'
import type { PreviewEntry, PreviewsBySession } from '../model/preview'
import { PreviewTab } from './PreviewTab'
import { browserEngine, hostsInFrame } from '../model/browserUrl'
import { closeNativePages } from '../model/nativePages'
import { workspaceOf } from '@/shared/lib/workspaceOf'
import { useNativeBrowserAgent } from './useNativeBrowserAgent'

interface BackgroundPreviewHost {
  sessionId: string
  entry: PreviewEntry
  key: string
}

/** Every live preview needs a host: dropping later entries makes the `browser` tool unreachable. */
export function selectBackgroundPreviewHosts(
  tabs: PreviewsBySession,
  live: Record<string, boolean>,
  foreground: Record<string, number>,
): BackgroundPreviewHost[] {
  return Object.entries(tabs)
    .flatMap(([sessionId, entries]) =>
      entries.map((entry) => ({
        sessionId,
        entry,
        key: previewHostKey(sessionId, entry.previewId),
      })),
    )
    .filter(({ key, entry }) => hostsInFrame(entry) && live[key] && !foreground[key])
}

/**
 * A run ended: its workspace's off-screen tabs give up their renderers. The tabs stay in the strip
 * and come back when shown, or when the agent commands one again (`routePreviewCommand`).
 */
export function releaseBackgroundPreviews(sessionId: string): void {
  const workspace = workspaceOf(sessionId)
  usePreviewHosts.getState().releaseWorkspace(workspace)
  const { foreground } = usePreviewHosts.getState()
  const native = (usePreviewStore.getState().previewTabsBySession[workspace] ?? [])
    .filter(
      (entry) =>
        browserEngine(entry) === 'native' &&
        !foreground[previewHostKey(sessionId, entry.previewId)],
    )
    .map((entry) => entry.previewId)
  closeNativePages(native, 'Could not release background browser pages')
}

/** Host the previews an agent is using off screen, independently of the selected conversation. */
export default function BackgroundPreviews() {
  const tabs = usePreviewStore((s) => s.previewTabsBySession)
  useNativeBrowserAgent(tabs)
  useEffect(() => {
    if (!isDesktop) return
    return eventSocket.onSessionEvent((sessionId, event) => {
      if (event.type === 'preview.command') routePreviewCommand(sessionId, event)
      if (event.type === 'preview.updated') routePreviewUpdated(sessionId, event)
    })
  }, [])
  useEffect(
    () =>
      eventSocket.onSessionEvent((sessionId, event) => {
        if (event.type === 'run.completed' || event.type === 'run.failed')
          releaseBackgroundPreviews(sessionId)
      }),
    [],
  )
  const live = usePreviewHosts((s) => s.live)
  const foreground = usePreviewHosts((s) => s.foreground)
  const hosts = selectBackgroundPreviewHosts(tabs, live, foreground)
  return (
    <>
      {hosts.map(({ sessionId, entry, key }) => (
        <div
          key={key}
          aria-hidden="true"
          style={{
            position: 'fixed',
            display: 'flex',
            left: -10000,
            top: 0,
            width: 1280,
            height: 800,
            pointerEvents: 'none',
          }}
        >
          <PreviewTab key={entry.version} {...entry} sessionId={sessionId} backgroundHost />
        </div>
      ))}
    </>
  )
}
