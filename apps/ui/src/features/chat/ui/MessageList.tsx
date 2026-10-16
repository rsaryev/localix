import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Message } from '../model/types'
import { MessageCard } from './MessageCard'
import { AddressableMessageRow } from './AddressableMessageRow'
import { messageTargetUri } from './messageTargetUri'
import { useReplayFocusTracking } from './useReplayFocusTracking'
import { useTranscriptJumps } from './useTranscriptJumps'
import { useVirtualGeometryPersistence } from './useVirtualGeometryPersistence'
import { SystemNoticeLine } from './SystemNoticeLine'
import { CommandOutputLine } from './CommandOutputLine'
import { LabelDivider } from '@localixai/kit/label-divider'
import { createTranscriptProjectionSelector } from './transcriptProjection'
import { systemMessageLabel } from './coalesceSystemMessages'
import { ToolChain } from './tool-parts/ToolChain'
import { messageDisplayRows, messagePositions } from '../model/messageGroups'
import { TranscriptMinimap } from './transcript-minimap/TranscriptMinimap'
import { buildMinimapTicks } from './transcript-minimap/minimapModel'
import { prefersReducedMotion } from '@localixai/kit/environment'
import {
  CHAT_PAD_BOTTOM,
  CHAT_PAD_TOP,
  CHAT_ROW_GAP,
  ESTIMATED_CHAT_ROW_HEIGHT,
  openedTranscriptBottomOffset,
} from './messageListScroll'
import { chatMeasurementsForWidth, getChatScrollSnapshot } from '@/shared/hooks/chatScrollState'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { SurfaceErrorBoundary } from '@/shared/ui/SurfaceErrorBoundary'
import { deriveWakeProvenance, wakeSourceLabel } from '@localixai/api/wake-provenance'

interface MessageListProps {
  density?: 'default' | 'lite'
  /** Small transcript surfaces do not need workspace-sized space above and below messages. */
  edgePadding?: 'default' | 'none'
  messages: Message[]
  isGenerating: boolean
  /** Id of the assistant message actually receiving the live stream (from the
   *  session's stream events). Streaming visuals key on this — a positional
   *  "last row while running" guess mis-tags the previous reply during the
   *  send→echo round-trip and makes it re-type from scratch. */
  streamingMessageId?: string | null
  /** The scrollable viewport that owns this list (from useAutoScroll). */
  scrollRef: RefObject<HTMLDivElement | null>
  /** Follow-preserving tail correction after the virtualizer measures a new
   * transcript height. A reader who scrolled up remains untouched. */
  onContentSizeChange?: () => void
  /** Active session id — used to pin to the latest message on (direct) load. */
  sessionId: string | null
  onRegenerate?: () => void
  onRollback?: (messageId: string) => void
  onEdit?: (messageId: string, content: string) => void
  onSwitchBranch?: (messageId: string, branchIndex: number) => void
  onOpenThread?: (messageId: string) => void
  /** True for the focused chat surface — the only list that answers the global
   *  previous/next-prompt navigation commands (so N mounted surfaces don't all
   *  scroll at once). */
  navActive?: boolean
  /** Current agnostic activity-phase label (e.g. "Generating title"), shown in
   * the loading skeleton of the streaming message. */
  phaseLabel?: string
}

function MessageListImpl({
  density = 'default',
  edgePadding = 'default',
  messages,
  isGenerating,
  streamingMessageId,
  scrollRef,
  onContentSizeChange,
  sessionId,
  navActive,
  onRegenerate,
  onRollback,
  onEdit,
  onSwitchBranch,
  onOpenThread,
  phaseLabel,
}: MessageListProps) {
  const compact = density === 'lite'
  const workItemVisible = useWorkItemVisible()
  const projectTranscript = useMemo(() => createTranscriptProjectionSelector(), [])
  const visible = projectTranscript(messages)
  const wakeSources = useMemo(() => deriveWakeProvenance(messages), [messages])
  // Derived from the PROJECTED rows, not the raw ones: notices are interleaved by the
  // projection, and they are exactly what breaks a run of one speaker.
  const positions = useMemo(() => messagePositions(visible), [visible])
  const rows = useMemo(() => messageDisplayRows(visible), [visible])
  const rowById = useMemo(() => {
    const indices = new Map<string, number>()
    rows.forEach((row, index) => row.segments.forEach((segment) => indices.set(segment.id, index)))
    return indices
  }, [rows])
  const lastIndex = rows.length - 1

  // The parent owns the scroll container ref, and a parent ref is attached AFTER
  // this child's layout effects run — so on first mount scrollRef.current is null
  // when the virtualizer initializes and it never observes the element until some
  // later re-render. Mirror it into state (set in a passive effect, which runs
  // after the parent ref is attached) to force exactly that re-render.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    setScrollEl(scrollRef.current)
  }, [scrollRef])

  // Reuse measured row heights to avoid estimate-to-real layout shifts, but never
  // restore the snapshot's scrollTop here. useAutoScroll owns navigation policy:
  // opening/switching a chat goes to the tail, while a still-mounted warm viewport
  // preserves its own position without reinitializing this virtualizer.
  const cachedVirtualState = useMemo(() => getChatScrollSnapshot(sessionId), [sessionId])

  // Row heights are a function of the wrap width, so cached geometry is only
  // reusable at the width it was measured at. Track the live width every render
  // (the virtualizer re-renders on viewport resize) so the unmount below can
  // stamp it even once the node has detached.
  const measuredWidthRef = useRef(0)
  const viewportWidth = scrollEl?.clientWidth ?? scrollRef.current?.clientWidth ?? 0
  if (viewportWidth > 0) measuredWidthRef.current = viewportWidth
  const widthMeasurements = chatMeasurementsForWidth(cachedVirtualState, viewportWidth)
  // Old snapshots may predate grouping (or a refetch may change continuation links).
  // Index-only sizes would attach a two-card height to an unrelated one-card row.
  const cachedMeasurements = widthMeasurements?.every(
    (measurement) =>
      measurement.key ===
      (rows[measurement.index]?.segments[0]?.renderKey ?? rows[measurement.index]?.segments[0]?.id),
  )
    ? widthMeasurements
    : undefined

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual's useVirtualizer returns non-memoizable functions by design; informational, not actionable.
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollEl,
    // Generous estimate; rows self-correct via measureElement once mounted.
    estimateSize: () => ESTIMATED_CHAT_ROW_HEIGHT,
    // Warm tabs stay mounted under display:none. Freeze their known sizes while
    // hidden instead of feeding ResizeObserver's 0px boxes into the cache.
    useCachedMeasurements: !workItemVisible,
    enabled: workItemVisible,
    // Chat is a reverse feed: stable keys keep the same visible message anchored
    // when history is prepended, and a pinned streaming tail follows row growth.
    anchorTo: 'end',
    // useAutoScroll owns tail following and explicit wheel/selection intent. End anchoring's
    // independent near-bottom test would undo an unpin inside its 80px band on the next resize.
    // Keep prepend anchoring, but let the content observer perform the one tail correction.
    scrollEndThreshold: -1,
    // Big overscan keeps streaming + fast scrolling smooth and lets the
    // bottom-pinned auto-scroll land on a measured row.
    overscan: 8,
    // renderKey first: the echo claim swaps an optimistic row's id for the
    // server id in place — keying on the raw id would remount the row (and
    // visibly restart its typing status) ~200ms after Enter.
    getItemKey: (index) =>
      rows[index]?.segments[0]?.renderKey ?? rows[index]?.segments[0]?.id ?? index,
    paddingStart: compact || edgePadding === 'none' ? 0 : CHAT_PAD_TOP,
    paddingEnd: compact || edgePadding === 'none' ? 0 : CHAT_PAD_BOTTOM,
    gap: CHAT_ROW_GAP,
    initialOffset: () =>
      openedTranscriptBottomOffset(
        rows.length,
        scrollRef.current?.clientHeight ?? 0,
        cachedMeasurements,
      ),
    initialMeasurementsCache: cachedMeasurements ?? [],
  })

  useVirtualGeometryPersistence(
    sessionId,
    scrollEl,
    virtualizer,
    cachedVirtualState,
    cachedMeasurements,
    measuredWidthRef,
  )

  const totalSize = virtualizer.getTotalSize()
  useEffect(() => {
    if (!scrollEl) return
    onContentSizeChange?.()
  }, [onContentSizeChange, scrollEl, totalSize])

  // Pin every newly mounted/switched session to its latest message. TanStack's
  // scrollToEnd reconciles estimate→measurement target changes, while end
  // anchoring keeps late-growing content pinned after that initial landing.
  const pinnedForSession = useRef<string | null>(null)
  // `hasRows` is a dependency, not just a guard: returning to a session whose
  // messages are still loading used to bail here once (0 rows) and never re-arm —
  // the rows then landed with the viewport stuck wherever the old session's
  // content-clamp left it (mid-transcript). When the rows arrive, the flip of
  // `hasRows` re-runs the effect and takes it to the bottom.
  const hasRows = rows.length > 0
  useLayoutEffect(() => {
    if (!workItemVisible || !scrollEl || !sessionId || !hasRows) return
    if (pinnedForSession.current === sessionId) return
    pinnedForSession.current = sessionId
    virtualizer.scrollToEnd()
  }, [sessionId, scrollEl, virtualizer, hasRows, workItemVisible])

  const rowsRef = useRef(rows)
  rowsRef.current = rows
  useReplayFocusTracking(scrollEl, sessionId, virtualizer, rowsRef)
  useTranscriptJumps({
    sessionId,
    scrollEl,
    virtualizer,
    rows,
    rowById,
    visible,
    workItemVisible,
    navActive,
  })

  // Minimap feed: tick offsets come from the virtualizer (a virtualized
  // transcript has no per-message DOM to measure for off-screen rows). The
  // minimap's own ResizeObserver/rAF cadence decides WHEN to call this.
  const minimapTicks = useMemo(() => buildMinimapTicks(rows.map((row) => row.segments[0]!)), [rows])
  const getMinimapOffsets = useCallback(
    () => ({
      offsets: minimapTicks.map(
        (tick) => virtualizer.getOffsetForIndex(tick.index, 'start')?.[0] ?? 0,
      ),
      totalSize: virtualizer.getTotalSize(),
    }),
    [minimapTicks, virtualizer],
  )
  const jumpToRow = useCallback(
    (rowIndex: number) => {
      virtualizer.scrollToIndex(rowIndex, {
        align: 'start',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      })
    },
    [virtualizer],
  )

  const items = virtualizer.getVirtualItems()

  return (
    <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {!compact && (
        <TranscriptMinimap
          scrollEl={scrollEl}
          ticks={minimapTicks}
          getOffsets={getMinimapOffsets}
          onJump={jumpToRow}
          sessionId={sessionId}
        />
      )}
      {items.map((vi) => {
        const row = rows[vi.index]
        const m = row?.segments[0]
        if (!m) return null
        const tail = row.segments.at(-1)!
        return (
          <AddressableMessageRow
            compact={compact}
            key={vi.key}
            uri={messageTargetUri(sessionId, m.id)}
            item={vi}
            virtualizer={virtualizer}
          >
            <SurfaceErrorBoundary key={m.id} surface="This message">
              {m.systemActivity ? (
                <ToolChain
                  items={[]}
                  activity={m.systemActivity}
                  isLatest={vi.index === lastIndex}
                />
              ) : m.role === 'system' && m.commandOutput ? (
                <CommandOutputLine output={m.commandOutput} repeatCount={m.systemRepeatCount} />
              ) : m.role === 'system' && m.systemNotice ? (
                // The same re-run the message actions offer — a notice that asks for a
                // decision gets the control to make it, not a second mechanism.
                <SystemNoticeLine
                  notice={m.systemNotice}
                  createdAt={m.createdAt}
                  repeatCount={m.systemRepeatCount}
                  onRetry={onRegenerate}
                />
              ) : m.uiOnly ? (
                <LabelDivider role="presentation" className="py-1">
                  {systemMessageLabel(m.content ?? '', m.systemRepeatCount)}
                </LabelDivider>
              ) : (
                <MessageCard
                  compact={compact}
                  message={tail}
                  segments={row.segments.length > 1 ? row.segments : undefined}
                  segmentSessionId={sessionId}
                  segmentWakeSources={row.segments.map((segment) => wakeSources.get(segment.id))}
                  triggerLabel={wakeSourceLabel(wakeSources.get(m.id))}
                  triggerSource={wakeSources.get(m.id)}
                  // streamingMessageId equality is authoritative (see the prop
                  // doc above) — a positional "last row" gate would kill the live
                  // reply's visuals the instant a busy-send or a hook notice
                  // appends a newer row below it.
                  isStreaming={
                    isGenerating && tail.role === 'assistant' && streamingMessageId === tail.id
                  }
                  isLast={vi.index === lastIndex}
                  isGenerating={isGenerating}
                  position={{
                    ...positions[row.firstIndex]!,
                    isLastInGroup:
                      positions[row.firstIndex + row.segments.length - 1]!.isLastInGroup,
                  }}
                  phaseLabel={
                    (streamingMessageId ? tail.id === streamingMessageId : vi.index === lastIndex)
                      ? phaseLabel
                      : undefined
                  }
                  onRegenerate={onRegenerate}
                  onRollback={onRollback}
                  onEdit={onEdit}
                  onSwitchBranch={onSwitchBranch}
                  onOpenThread={onOpenThread}
                />
              )}
            </SurfaceErrorBoundary>
          </AddressableMessageRow>
        )
      })}
    </div>
  )
}

export const MessageList = memo(MessageListImpl)
