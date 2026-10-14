import { useEffect, useRef, useState, type RefObject } from 'react'

export interface ComposerHeightResult {
  /** Attach to the composer wrapper element to observe its height. */
  composerRef: RefObject<HTMLDivElement | null>
  /** Current composer height in px (border-box), used to offset overlays. */
  composerHeight: number
}

/**
 * Tracks the composer's rendered height via a ResizeObserver so floating
 * overlays (e.g. the scroll-to-bottom button) can sit just above it.
 * Extracted from ChatSurface.
 */
export function useComposerHeight(): ComposerHeightResult {
  const composerRef = useRef<HTMLDivElement | null>(null)
  const [composerHeight, setComposerHeight] = useState(0)

  useEffect(() => {
    const composerNode = composerRef.current
    if (!composerNode) return

    const resizeObserver = new ResizeObserver(([entry]) => {
      setComposerHeight(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height)
    })
    resizeObserver.observe(composerNode)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  return { composerRef, composerHeight }
}
