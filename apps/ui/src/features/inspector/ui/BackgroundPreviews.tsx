import { useEffect } from 'react'
import { eventSocket } from '@/shared/api/eventSocket'
import { isDesktop } from '@localixai/kit/environment'
import { routePreviewCommand, routePreviewUpdated } from '@/features/chat/model/sessionEventRouters'
import { usePreviewStore } from '../model/previewStore'
import { previewHostKey, usePreviewHosts } from '../model/previewHosts'
import type { PreviewEntry, PreviewsBySession } from '../model/preview'
import { PreviewTab } from './PreviewTab'
import { hostsInFrame } from '../model/browserUrl'
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

/** Keep agent previews alive independently of the selected conversation or inspector pane. */
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
