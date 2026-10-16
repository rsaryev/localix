import { useCallback, useEffect, useState } from 'react'
import { previewHostKey, usePreviewHosts } from '../model/previewHosts'
import { usePreviewStore } from '../model/previewStore'
import {
  PREVIEW_VIEWPORT_FILL,
  isFixedViewport,
  type PreviewViewportPreset,
} from '../model/previewViewportPresets'

/** Manual controls and agent commands must size the same frame and remember the
 * same dimensions when its owning conversation is hidden and shown again. */
export function usePreviewViewport({
  sessionId,
  previewId,
  initialViewport,
  backgroundHost,
  active,
}: {
  sessionId: string | null
  previewId?: string
  initialViewport?: { width: number; height: number } | null
  backgroundHost: boolean
  active: boolean
}) {
  useEffect(() => {
    if (!backgroundHost && active && sessionId && previewId)
      return usePreviewHosts.getState().attach(previewHostKey(sessionId, previewId))
  }, [backgroundHost, active, sessionId, previewId])
  useEffect(() => {
    if (backgroundHost || !active || !sessionId || !previewId) return
    const store = usePreviewStore.getState()
    const entry = store.previewTabsBySession[sessionId]?.find((tab) => tab.previewId === previewId)
    if (entry && !entry.userOpened)
      store.recordPreview(sessionId, { ...entry, background: false, userOpened: true })
  }, [backgroundHost, active, sessionId, previewId])
  const [viewport, setViewport] = useState<PreviewViewportPreset>(
    initialViewport ? { label: 'Custom', ...initialViewport } : PREVIEW_VIEWPORT_FILL,
  )
  // The warm foreground pane can be hidden while a background command resizes
  // its replacement host. On reveal, reflect the remembered dimensions as well.
  useEffect(() => {
    if (active)
      setViewport((previous) =>
        previous.width === (initialViewport?.width ?? null) &&
        previous.height === (initialViewport?.height ?? null)
          ? previous
          : initialViewport
            ? { label: 'Custom', ...initialViewport }
            : PREVIEW_VIEWPORT_FILL,
      )
  }, [active, initialViewport])
  const changeViewport = useCallback(
    (next: PreviewViewportPreset, opts: { byAgent?: boolean } = {}) => {
      setViewport(next)
      // Remembered on the tab, in the strip of the chat that owns it; a frame with no chat has
      // no strip to remember it in.
      if (sessionId && previewId)
        usePreviewStore
          .getState()
          .setPreviewViewport(
            sessionId,
            previewId,
            isFixedViewport(next) ? { width: next.width!, height: next.height! } : null,
            opts.byAgent,
          )
    },
    [sessionId, previewId],
  )
  return { viewport, fixedViewport: isFixedViewport(viewport), changeViewport }
}
