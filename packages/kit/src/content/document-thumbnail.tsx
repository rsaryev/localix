import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'

/** First-page thumbnail of actual document content, scaled from a fixed A4 reading width. */
export function DocumentThumbnail({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const node = root.current
    if (!node) return
    const update = () => setWidth(node.getBoundingClientRect().width)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return (
    <div
      ref={root}
      aria-hidden="true"
      className={cn(
        'relative aspect-[210/297] w-full overflow-hidden bg-document-paper text-document-ink',
        className,
      )}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: 794, minHeight: 1123, transform: `scale(${width / 794})` }}
      >
        {children}
      </div>
    </div>
  )
}
