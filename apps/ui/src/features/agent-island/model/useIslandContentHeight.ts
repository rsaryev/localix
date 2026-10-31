import { useLayoutEffect, useRef, useState } from 'react'
import { clampOpenHeight, ISLAND } from './geometry'

/** Measure intrinsic content, never the animated shell, so replies cannot create resize loops. */
export function useIslandContentHeight(notchHeight: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>(ISLAND.openInitialHeight)
  useLayoutEffect(() => {
    const content = ref.current
    if (!content) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.height <= 0) return
      const measured = entry.borderBoxSize[0]?.blockSize ?? content.getBoundingClientRect().height
      setHeight(clampOpenHeight(measured, notchHeight))
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [notchHeight])
  return { ref, height }
}
