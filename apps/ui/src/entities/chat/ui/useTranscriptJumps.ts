import { useEffect, useRef, type RefObject } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import { localixResourceUri } from '@localixai/mini-app-sdk/navigation'
import type { Message } from '../model/types'
import type { MessageDisplayRow } from '../model/messageGroups'
import { useChatStore } from '../model/store'
import { eventFocusMessageId, visibleEventFocusRequest } from './messageTargetUri'
import { ringMessage } from './messageRing'
import { useMessageFocusStore } from '@/shared/lib/messageFocusBus'
import { useMessageSearchStore } from '@/shared/lib/messageSearchBus'
import { useTranscriptNavStore } from '@/shared/lib/transcriptNavBus'
import { nextPromptIndex } from '@/shared/lib/transcriptNav'
import { registerUiTargetMaterializer } from '@/shared/lib/uiTargetRegistry'
import { useEventFocusStore } from '@/shared/lib/eventFocusBus'

type ChatVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>

interface TranscriptJumpOptions {
  sessionId: string | null
  scrollEl: HTMLDivElement | null
  virtualizer: ChatVirtualizer
  rows: MessageDisplayRow[]
  rowById: Map<string, number>
  visible: readonly Message[]
  workItemVisible: boolean
  navActive?: boolean
}

/** Every "scroll the transcript to X" request a mounted MessageList answers. */
export function useTranscriptJumps({
  sessionId,
  scrollEl,
  virtualizer,
  rows,
  rowById,
  visible,
  workItemVisible,
  navActive,
}: TranscriptJumpOptions): void {
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const rowByIdRef = useRef(rowById)
  rowByIdRef.current = rowById

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

  // Cross-chat message links: the link navigates and leaves a focus request in the chat
  // store. The target transcript claims it once visible and its row exists, then rings it
  // (the search seam below does the scroll). Same visibility rule as event focus.
  const focusMessageId = useChatStore((s) => s.focusMessageId)
  const focusMessageSessionId = useChatStore((s) => s.focusMessageSessionId)
  useEffect(() => {
    if (!focusMessageId || !sessionId || !workItemVisible) return
    if (focusMessageSessionId !== sessionId) return
    if (!rowById.has(focusMessageId)) return
    useChatStore.getState().clearMessageFocus()
    ringMessage(focusMessageId)
  }, [focusMessageId, focusMessageSessionId, sessionId, workItemVisible, rowById])

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

  // In-conversation search: scroll the active match into view. Reads rows
  // through a ref so a streaming message update doesn't re-trigger the scroll.
  const searchActiveId = useMessageSearchStore((s) => s.activeId)
  useEffect(() => {
    if (!searchActiveId) return
    const idx = rowByIdRef.current.get(searchActiveId) ?? -1
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'center' })
  }, [searchActiveId, virtualizer])

  usePromptNavigation(navActive, scrollEl, virtualizer, rows)

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
}

/**
 * Previous/next user-prompt navigation. Only the focused surface reacts. The anchor is the row
 * currently at the top of the viewport (read live from the virtualizer), so jumps are relative
 * to what you're looking at and never desync from a stored cursor. Subscribe to the raw signal
 * (shared across surfaces) and gate on focus INSIDE the effect — so toggling which surface is
 * focused never itself triggers a jump.
 */
function usePromptNavigation(
  navActive: boolean | undefined,
  scrollEl: HTMLDivElement | null,
  virtualizer: ChatVirtualizer,
  rows: MessageDisplayRow[],
): void {
  const navSignal = useTranscriptNavStore((s) => s.signal)
  const seenNavSignalRef: RefObject<number> = useRef(navSignal)
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
}
