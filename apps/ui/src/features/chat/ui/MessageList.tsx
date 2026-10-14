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
import { localixResourceUri } from '@localixai/plugin-sdk/navigation'
import { isToolBackedItem } from '@localixai/agent/agents/items'
import type { Message } from '../model/types'
import { MessageCard } from './MessageCard'
import { AddressableMessageRow } from './AddressableMessageRow'
import { eventFocusMessageId, messageTargetUri, visibleEventFocusRequest } from './messageTargetUri'
import { SystemNoticeLine } from './SystemNoticeLine'
import { CommandOutputLine } from './CommandOutputLine'
import { LabelDivider } from '@localixai/kit/label-divider'
import { useMessageFocusStore } from '@/shared/lib/messageFocusBus'
import { useMessageSearchStore } from '@/shared/lib/messageSearchBus'
import { useTranscriptNavStore } from '@/shared/lib/transcriptNavBus'
import { nextPromptIndex } from '@/shared/lib/transcriptNav'
import { createTrailingThrottle } from '@/shared/lib/throttle'
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
import {
  chatMeasurementsForWidth,
  getChatScrollSnapshot,
  measurementsUsableAtWidth,
  saveChatVirtualMeasurements,
} from '@/shared/hooks/chatScrollState'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { registerUiTargetMaterializer } from '@/shared/lib/uiTargetRegistry'
import { useEventFocusStore } from '@/shared/lib/eventFocusBus'
import { SurfaceErrorBoundary } from '@/shared/ui/SurfaceErrorBoundary'
import { deriveWakeProvenance, wakeSourceLabel } from '@localixai/api/wake-provenance'

interface MessageListProps {
  density?: 'default' | 'lite'
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
    paddingStart: compact ? 0 : CHAT_PAD_TOP,
    paddingEnd: compact ? 0 : CHAT_PAD_BOTTOM,
    gap: CHAT_ROW_GAP,
    initialOffset: () =>
      openedTranscriptBottomOffset(
        rows.length,
        scrollRef.current?.clientHeight ?? 0,
        cachedMeasurements,
      ),
    initialMeasurementsCache: cachedMeasurements ?? [],
  })

  // The width above is 0 on the first render (the parent attaches its scroll ref
  // after this child's layout effects), so the cache can be seeded before it can
  // be judged. Judge it on the first commit that HAS a width and drop it there —
  // `measure()` clears the size cache, so rows re-measure from the estimate
  // instead of replaying heights from another pane width.
  const widthCheckedRef = useRef(false)
  useLayoutEffect(() => {
    if (widthCheckedRef.current || !scrollEl) return
    const width = scrollEl.clientWidth
    if (width <= 0) return
    widthCheckedRef.current = true
    if (!cachedMeasurements) {
      if (cachedVirtualState?.measurements) virtualizer.measure()
      return
    }
    if (measurementsUsableAtWidth(cachedVirtualState?.measurementWidth, width)) return
    virtualizer.measure()
  }, [scrollEl, cachedVirtualState, cachedMeasurements, virtualizer])

  // A warm body keeps this virtualizer instance. If the grid eventually evicts
  // it, persist the measured geometry too; scrollTop alone cannot round-trip a
  // dynamically measured transcript without estimate→actual layout drift.
  useEffect(
    () => () => {
      if (!sessionId) return
      saveChatVirtualMeasurements(sessionId, virtualizer.takeSnapshot(), measuredWidthRef.current)
    },
    [sessionId, virtualizer],
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

  // Snapshot replay: while the inspector's Snapshot tab is open, track the
  // topmost tool-bearing message in view and point the tab at it. Gated on
  // `active` so this listener costs nothing when the tab isn't mounted.
  const replayActive = useMessageFocusStore((s) => s.active)
  const setReplayFocus = useMessageFocusStore((s) => s.setFocus)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const rowByIdRef = useRef(rowById)
  rowByIdRef.current = rowById
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  const eventFocusSequence = useEventFocusStore((state) => state.sequence)
  useEffect(() => {
    const focusState = useEventFocusStore.getState()
    const request = visibleEventFocusRequest(focusState.pending, sessionId, workItemVisible)
    // Warm transcripts stay mounted under display:none. They must not claim the
    // request until their session is actually visible: a disabled virtualizer
    // cannot perform an observable scroll/reveal, and consuming here used to
    // make cross-session Event Center jumps silently lose their highlight.
    if (!request) return
    const messageId = eventFocusMessageId(visibleRef.current, request)
    if (!messageId) return
    const index = rowByIdRef.current.get(messageId) ?? -1
    if (index < 0) return
    virtualizer.scrollToIndex(index, { align: 'center' })
    focusState.consume(request.token)
  }, [eventFocusSequence, sessionId, visible.length, virtualizer, workItemVisible])
  useEffect(() => {
    if (!replayActive || !scrollEl || !sessionId) return
    const push = createTrailingThrottle((messageId: string) => {
      const sid = sessionIdRef.current
      if (sid) setReplayFocus(sid, messageId)
    }, 150)
    const onScroll = () => {
      // Pinned: the tab is frozen on a chosen message — don't chase the scroll.
      if (useMessageFocusStore.getState().pinned) return
      const top = scrollEl.scrollTop
      for (const vi of virtualizer.getVirtualItems()) {
        // Skip rows scrolled fully above the fold; first remaining row with tool
        // activity wins (so plain-text rows don't blank the panel).
        if (vi.start + vi.size <= top + 12) continue
        const m = rowsRef.current[vi.index]?.segments.find((segment) =>
          (segment.items ?? []).some(isToolBackedItem),
        )
        if (m) {
          push.call(m.id)
          break
        }
      }
    }
    onScroll()
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scrollEl.removeEventListener('scroll', onScroll)
      push.cancel()
    }
  }, [replayActive, scrollEl, sessionId, virtualizer, setReplayFocus])

  // Snapshot reverse-link: the tab's "jump to message" bumps `revealSignal`;
  // scroll the currently focused message into view via the same virtualizer path
  // the search bar uses. A counter (not an id) so a repeat jump re-fires.
  const revealSignal = useMessageFocusStore((s) => s.revealSignal)
  const seenRevealRef = useRef(revealSignal)
  useEffect(() => {
    if (revealSignal === seenRevealRef.current) return
    seenRevealRef.current = revealSignal
    const focus = useMessageFocusStore.getState()
    if (focus.sessionId !== sessionId) return
    const idx = focus.messageId ? (rowByIdRef.current.get(focus.messageId) ?? -1) : -1
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'center' })
  }, [revealSignal, sessionId, virtualizer])

  // In-conversation search: scroll the active match into view. Reads `visible`
  // through its ref so a streaming message update doesn't re-trigger the scroll.
  const searchActiveId = useMessageSearchStore((s) => s.activeId)
  useEffect(() => {
    if (!searchActiveId) return
    const idx = rowByIdRef.current.get(searchActiveId) ?? -1
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'center' })
  }, [searchActiveId, virtualizer])

  // Previous/next user-prompt navigation. Only the focused surface reacts. The
  // anchor is the row currently at the top of the viewport (read live from the
  // virtualizer), so jumps are relative to what you're looking at — matching how
  // "next change" works in an editor — and never desync from a stored cursor.
  // Subscribe to the raw signal (shared across surfaces) and gate on focus INSIDE
  // the effect — so toggling which surface is focused never itself triggers a jump.
  const navSignal = useTranscriptNavStore((s) => s.signal)
  const seenNavSignalRef = useRef(navSignal)
  useEffect(() => {
    const prev = seenNavSignalRef.current
    seenNavSignalRef.current = navSignal
    if (!navActive || !scrollEl || navSignal === prev) return
    const dir = useTranscriptNavStore.getState().dir
    const userIndices: number[] = []
    for (let i = 0; i < rows.length; i += 1) {
      const m = rows[i]!.segments[0]!
      if (m.role === 'user' && !m.isInternal && !m.uiOnly) userIndices.push(i)
    }
    // Topmost row in view: first virtual item whose bottom is below the fold.
    const top = scrollEl.scrollTop
    let anchor = rows.length - 1
    for (const vi of virtualizer.getVirtualItems()) {
      if (vi.start + vi.size > top + 1) {
        anchor = vi.index
        break
      }
    }
    const target = nextPromptIndex(userIndices, anchor, dir)
    if (target != null) virtualizer.scrollToIndex(target, { align: 'start' })
  }, [navSignal, navActive, scrollEl, virtualizer, rows])

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

  useEffect(() => {
    if (!sessionId) return
    const prefix = localixResourceUri('chat', ['message', sessionId])
    return registerUiTargetMaterializer({
      id: `chat-message-list:${sessionId}`,
      supports: (uri) => uri.startsWith(`${prefix}/`),
      materialize: (uri) => {
        const target = uri.slice(`${prefix}/`.length).split(/[?#]/, 1)[0]
        if (!target) return
        let messageId = target
        try {
          messageId = decodeURIComponent(target)
        } catch {
          // Preserve the raw id: malformed external URIs simply will not match.
        }
        const index = rowByIdRef.current.get(messageId) ?? -1
        if (index >= 0) virtualizer.scrollToIndex(index, { align: 'center' })
      },
    })
  }, [sessionId, virtualizer])

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
