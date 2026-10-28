import { useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Pause, Play } from 'lucide-react'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { Button } from '@localixai/kit/button'
import { LiveLogRow } from './LiveLogRow'
import { isLogViewportNearBottom, type LogLine } from './model/logLines'

/** Blank tail below the last line so the floating pause/resume control never covers it. */
const TAIL_CLEARANCE_PX = 56
/** Breathing room above the first line; every row is translated down by this inset. */
const TOP_INSET_PX = 4

export function LiveLogViewport({
  ariaLabel,
  emptyLabel,
  error,
  filteringSeverity,
  live,
  onLiveChange,
  query,
  visibleLines,
  wrap,
}: {
  ariaLabel: string
  emptyLabel: string
  error?: string | null
  filteringSeverity: boolean
  live: boolean
  onLiveChange: (live: boolean) => void
  query: string
  visibleLines: readonly LogLine[]
  wrap: boolean
}) {
  const workItemVisible = useWorkItemVisible()
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null)
  const pointerScrollIntentRef = useRef(false)
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual intentionally returns mutable measurement helpers.
  const virtualizer = useVirtualizer({
    count: visibleLines.length,
    getScrollElement: () => viewportElement,
    estimateSize: () => 18,
    overscan: 12,
    getItemKey: (index) => visibleLines[index]?.key ?? index,
    enabled: workItemVisible,
    useCachedMeasurements: !workItemVisible,
    anchorTo: 'end',
    followOnAppend: live,
    scrollEndThreshold: 32,
  })
  const virtualRows = virtualizer.getVirtualItems()

  const scrollToTail = useCallback(() => {
    virtualizer.scrollToEnd()
  }, [virtualizer])

  // Initial mount, filter changes, and wrap changes establish a fresh live tail.
  // Ordinary appends and dynamic row growth are handled by the end-anchored
  // virtualizer without scheduling one React effect per log update.
  useEffect(() => {
    if (!workItemVisible || !live) return
    const frame = requestAnimationFrame(() => scrollToTail())
    return () => cancelAnimationFrame(frame)
  }, [live, query, scrollToTail, workItemVisible, wrap])

  const pause = () => onLiveChange(false)
  const resume = () => {
    onLiveChange(true)
    requestAnimationFrame(scrollToTail)
  }

  return (
    <>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the scroll and pointer handlers only track how the person reads the log; the log itself stays a log */}
      <div
        ref={setViewportElement}
        role="log"
        aria-label={ariaLabel}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must take focus so the keyboard can scroll it
        tabIndex={0}
        data-scrollable
        className="scrollbar-thin virtual-scroller min-h-0 flex-1 overflow-auto font-mono text-2xs/relaxed"
        onScroll={(event) => {
          const nearBottom = isLogViewportNearBottom(
            event.currentTarget.scrollHeight,
            event.currentTarget.scrollTop,
            event.currentTarget.clientHeight,
          )
          if (live && pointerScrollIntentRef.current && !nearBottom) {
            pause()
          } else if (nearBottom) {
            pointerScrollIntentRef.current = false
          }
        }}
        onPointerDown={() => {
          pointerScrollIntentRef.current = true
        }}
        onPointerUp={() => {
          pointerScrollIntentRef.current = false
        }}
        onPointerCancel={() => {
          pointerScrollIntentRef.current = false
        }}
        onWheel={(event) => {
          if (
            live &&
            event.deltaY < 0 &&
            event.currentTarget.scrollHeight > event.currentTarget.clientHeight
          ) {
            pause()
          }
        }}
        onKeyDown={(event) => {
          if (
            live &&
            ['ArrowUp', 'PageUp', 'Home'].includes(event.key) &&
            event.currentTarget.scrollHeight > event.currentTarget.clientHeight
          ) {
            pause()
          }
        }}
      >
        {visibleLines.length > 0 ? (
          <div
            className="relative min-w-full"
            style={{ height: virtualizer.getTotalSize() + TOP_INSET_PX + TAIL_CLEARANCE_PX }}
          >
            {virtualRows.map((virtualRow) => {
              const line = visibleLines[virtualRow.index]
              if (!line) return null
              return (
                <LiveLogRow
                  key={line.key}
                  index={virtualRow.index}
                  line={line}
                  measureElement={virtualizer.measureElement}
                  query={query}
                  start={virtualRow.start}
                  wrap={wrap}
                />
              )
            })}
          </div>
        ) : (
          <div className="flex h-full min-h-40 items-center justify-center px-6 text-center text-xs text-text-faint">
            {query.trim()
              ? 'No matching log lines.'
              : filteringSeverity
                ? 'No log lines for the selected severities.'
                : error || emptyLabel}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-events-auto rounded-full bg-surface-raised/95"
          onClick={live ? pause : resume}
          aria-pressed={!live}
          aria-label={live ? 'Pause live logs' : 'Resume and follow live logs'}
          title={live ? 'Pause live logs' : 'Resume and follow live logs'}
        >
          {live ? <Pause className="size-3" /> : <Play className="size-3" />}
        </Button>
      </div>
    </>
  )
}
