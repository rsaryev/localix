import { useCallback, useEffect, useMemo, useRef } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { clampConsoleTail } from './consoleTail'
import { LinkedText, RawCopyButton } from './ToolIO'
import { SUGAR_HIGH_THEME } from '@/shared/ui/code-block/sugarHighTheme'

interface ConsoleOutputProps {
  output: string
  isStreaming: boolean
  /** Extra className for the <pre> container. */
  className?: string
}

/**
 * Pinned-tail-scroll monospace output block.
 *
 * While `isStreaming` is true, the viewport is kept pinned to the tail of the
 * output. The user can scroll up to unpin; arriving to within 12px of the
 * bottom re-pins automatically.
 *
 * Used by CommandCard to render live/inline command output.
 */
export function ConsoleOutput({ output, isStreaming, className }: ConsoleOutputProps) {
  const containerRef = useRef<HTMLPreElement>(null)
  const pinned = useRef(true)

  useEffect(() => {
    if (!isStreaming || !pinned.current) return
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [output, isStreaming])

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 12
  }, [])

  // Bound the DOM for pathologically large output — the viewer pins to the tail,
  // so keeping the last slice loses nothing the user is looking at.
  const display = useMemo(() => clampConsoleTail(output), [output])

  if (!output) return null

  return (
    <div className="group relative min-w-0">
      <RawCopyButton text={output} />
      <pre
        ref={containerRef}
        onScroll={handleScroll}
        className={cn(
          // `overscroll-contain`: this pane is nested inside the transcript scroller,
          // so hitting its end must not scroll the conversation out from under the
          // reader mid-gesture.
          'overflow-auto overscroll-contain scrollbar-thin px-1 py-1.5 pr-8 font-mono text-2xs leading-relaxed text-text-soft whitespace-pre-wrap break-all',
          SUGAR_HIGH_THEME,
          className,
        )}
        data-scrollable
      >
        {/* While streaming, render plain text — re-parsing path links every tick is
            wasteful. Once settled, turn file:line tokens into clickable jumps. */}
        {isStreaming ? display : <LinkedText text={display} syntax />}
      </pre>
    </div>
  )
}
