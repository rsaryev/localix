import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createScrollSyncGuard,
  observeScrollPercentTarget,
  percentToScrollTop,
  publishScrollPercent,
  scrollPercent,
} from '@localixai/kit/scroll-sync'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'

/**
 * Markdown split view: the editor and the rendered preview side by side, scroll-synced.
 *
 * The two panes never reference each other. They decouple through a DOM sync ATTRIBUTE
 * (see shared/ui/scrollSync): each publishes its own scroll percentage onto the OTHER's
 * host element, and each observes its own. That is what lets the preview be an ordinary
 * scroll container and Monaco editor, with no shared scroll controller.
 *
 * The subtlety this owns is the ECHO: applying an incoming percentage scrolls the pane,
 * which fires its own scroll event, which would publish back — a feedback loop that
 * makes both panes judder. The guard suppresses the publish for exactly the duration of
 * an applied scroll, so only USER scrolling propagates.
 */
export function useSplitScrollSync() {
  const workItemVisible = useWorkItemVisible()
  const [splitView, setSplitView] = useState(false)
  const [editorHostEl, setEditorHostEl] = useState<HTMLDivElement | null>(null)
  const [previewEl, setPreviewEl] = useState<HTMLDivElement | null>(null)
  const guardRef = useRef(createScrollSyncGuard())

  const toggleSplit = useCallback(() => setSplitView((v) => !v), [])

  /** Editor → preview. Handed to the editor as its onScroll. */
  const onEditorScroll = useCallback(
    (percent: number) => {
      if (workItemVisible) publishScrollPercent(previewEl, percent)
    },
    [previewEl, workItemVisible],
  )

  // Preview → editor, plus applying an incoming target (guarded so it doesn't echo).
  useEffect(() => {
    if (!workItemVisible || !splitView || !previewEl) return
    const guard = guardRef.current
    const onPreviewScroll = () => {
      if (guard.isGuarded()) return
      publishScrollPercent(editorHostEl, scrollPercent(previewEl))
    }
    previewEl.addEventListener('scroll', onPreviewScroll, { passive: true })
    const dispose = observeScrollPercentTarget(previewEl, (percent) => {
      guard.guard(() => {
        previewEl.scrollTop = percentToScrollTop(percent, previewEl)
      })
    })
    return () => {
      previewEl.removeEventListener('scroll', onPreviewScroll)
      dispose()
    }
  }, [splitView, previewEl, editorHostEl, workItemVisible])

  return { splitView, toggleSplit, editorHostEl, setEditorHostEl, setPreviewEl, onEditorScroll }
}
