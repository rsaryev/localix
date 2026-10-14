import { useEffect, useMemo, useRef } from 'react'
import { ChevronDown, ChevronUp, CornerUpLeft, History, Library, Pin, PinOff } from 'lucide-react'
import { isToolBackedItem } from '@localixai/agent/agents/items'
import type { AgentItem, AgentSource } from '@localixai/agent/agents'
import { useChatStore } from '@/features/chat/model/store'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'
import { findSessionInState } from '@/features/chat/model/findSession'
import { answerSourcesOfMessage } from '@/features/chat/model/sessionSources'
import { SourceRow } from '@/features/chat/ui/sources/SourceRow'
import { ToolTimingProvider } from '@/features/chat/ui/tool-parts/toolTimingContext'
import { ToolChain } from '@/features/chat/ui/tool-parts/ToolChain'
import { IconButton } from '@localixai/kit/icon-button'
import { StateNotice } from '@localixai/kit/state-notice'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import { useMessageFocusStore } from '@/shared/lib/messageFocusBus'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { motionSafeScrollBehavior } from '@localixai/kit/environment'
import { formatElapsed } from '@localixai/plugin-sdk/ui/utilities'
import { computeReplayNav } from '../model/replayNav'
import { MessageTurnCost, turnCostIcon } from './MessageTurnCost'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'

/**
 * Activity work item — mirrors the tool outputs (bash, file diffs, reads, …)
 * of the chat message the user is currently looking at, using the SAME cards as
 * the inline chat (ToolChain → ItemView). The focused message flows through the
 * message-focus store: set explicitly by a message's open action, and updated as
 * the user scrolls history (MessageList tracks the topmost tool-bearing message).
 *
 * Consecutive tool-backed items batch into one ToolChain cluster — the exact
 * grouping MessageCard uses — so a message's reads/edits/commands read as the
 * action groups they were, narrative text omitted (it already lives in the chat).
 */
export function MessageReplayTab() {
  const workItemVisible = useWorkItemVisible()
  const setActive = useMessageFocusStore((s) => s.setActive)
  const setFocus = useMessageFocusStore((s) => s.setFocus)
  // One Activity tab per chat, and ONE focus store for the app: the tab shows the focus only
  // while it names this tab's own chat. Following the store regardless, chat A's warm Activity
  // tab showed whatever message chat B had last focused.
  const tabSessionId = useWorkItemSessionId()
  const focusSessionId = useMessageFocusStore((s) => s.sessionId)
  const ownFocus = focusSessionId !== null && focusSessionId === tabSessionId
  const sessionId = ownFocus ? focusSessionId : null
  const focusMessageId = useMessageFocusStore((s) => s.messageId)
  const messageId = ownFocus ? focusMessageId : null
  const pinned = useMessageFocusStore((s) => s.pinned)
  const setPinned = useMessageFocusStore((s) => s.setPinned)
  const reveal = useMessageFocusStore((s) => s.reveal)
  const section = useMessageFocusStore((s) => s.section)
  const sectionSignal = useMessageFocusStore((s) => s.sectionSignal)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activityRef = useRef<HTMLElement>(null)
  const sourcesRef = useRef<HTMLElement>(null)

  // Warm work items stay mounted after a tab switch. The scroll tracker is useful
  // only while Activity is selected, not for the lifetime of its retained body.
  useEffect(() => {
    setActive(workItemVisible)
    return () => setActive(false)
  }, [workItemVisible, setActive])

  // Explicit message actions carry their own session id. Reading that session directly keeps a
  // Sources click in a background grid pane scoped to the pane it came from.
  const messages = useChatStore((state) =>
    sessionId ? findSessionInState(state, sessionId)?.messages : undefined,
  )
  const message = useMemo(
    () => (messageId ? messages?.find((m) => m.id === messageId) : undefined),
    [messages, messageId],
  )

  // Ordered ids of tool-bearing messages — the "checkpoints" you can step through
  // without scrolling the chat. Prev/next re-point the focus store; the same seam
  // the scroll tracker writes, so navigation and scroll-follow stay consistent.
  const checkpointIds = useMemo(
    () => (messages ?? []).flatMap((m) => ((m.items ?? []).some(isToolBackedItem) ? [m.id] : [])),
    [messages],
  )
  const nav = computeReplayNav(checkpointIds, messageId)
  const go = (id: string | null) => {
    if (id && sessionId) setFocus(sessionId, id)
  }

  // Split the message's items into the same consecutive tool-backed runs
  // MessageCard renders, so each cluster reads as one action group.
  const chains = useMemo(() => {
    const runs: AgentItem[][] = []
    let run: AgentItem[] = []
    for (const item of message?.items ?? []) {
      if (isToolBackedItem(item)) {
        run.push(item)
      } else if (run.length) {
        runs.push(run)
        run = []
      }
    }
    if (run.length) runs.push(run)
    return runs
  }, [message?.items])
  const sources = useMemo(() => (message ? answerSourcesOfMessage(message) : []), [message])

  // Explicit Sources / Activity actions target a section in this one flat panel. A monotonic
  // signal makes a repeated click useful even when the same message and section are already open.
  useEffect(() => {
    if (!workItemVisible || sectionSignal === 0 || !message) return
    const frame = requestAnimationFrame(() => {
      const scroller = scrollRef.current
      const target = section === 'sources' ? sourcesRef.current : activityRef.current
      if (!scroller || !target) return
      const top = Math.max(
        0,
        scroller.scrollTop +
          target.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          12,
      )
      if (typeof scroller.scrollTo === 'function') {
        scroller.scrollTo({ top, behavior: motionSafeScrollBehavior('smooth') })
      } else scroller.scrollTop = top
    })
    return () => cancelAnimationFrame(frame)
  }, [message, section, sectionSignal, workItemVisible])

  if (!message) {
    return <EmptyState>Scroll the chat or open a message to see its tool activity here.</EmptyState>
  }

  // The body is already inside its tab's session provider (`WorkItemBody`), the same session.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ReplayNavBar
        nav={nav}
        pinned={pinned}
        onPrev={() => go(nav.prevId)}
        onNext={() => go(nav.nextId)}
        onTogglePin={() => setPinned(!pinned)}
        onJump={reveal}
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="w-full px-4 py-5">
          <section ref={activityRef} aria-labelledby="message-activity-heading">
            <SectionHeading
              id="message-activity-heading"
              icon={History}
              title="Activity"
              meta={
                message.timing?.totalMs
                  ? formatElapsed(message.timing.totalMs)
                  : `${chains.length} step${chains.length === 1 ? '' : 's'}`
              }
            />
            {chains.length ? (
              <ToolTimingProvider tools={message.timing?.tools}>
                <div className="mt-3 flex flex-col">
                  {chains.map((run) => (
                    <ToolChain
                      key={`replay-${run[0]!.id}`}
                      items={run}
                      messageId={message.id}
                      deferredToolItemIds={message.deferredToolItemIds}
                      isLatest
                    />
                  ))}
                </div>
              </ToolTimingProvider>
            ) : (
              <InlineEmpty>This message has no tool activity.</InlineEmpty>
            )}
          </section>

          <section
            aria-labelledby="message-turn-cost-heading"
            className="mt-8 border-t border-border-soft pt-6"
          >
            <SectionHeading
              id="message-turn-cost-heading"
              icon={turnCostIcon}
              title="This turn"
              meta={message.usage ? `${(message.usage.totalTokens ?? 0).toLocaleString()} tok` : ''}
            />
            {message.usage || message.providerMeta ? (
              <MessageTurnCost usage={message.usage} provider={message.providerMeta} />
            ) : (
              <InlineEmpty>No provider accounting recorded for this message.</InlineEmpty>
            )}
          </section>

          <section
            ref={sourcesRef}
            aria-labelledby="message-sources-heading"
            className="mt-8 border-t border-border-soft pt-6"
          >
            <SectionHeading
              id="message-sources-heading"
              icon={Library}
              title="Sources"
              meta={String(sources.length)}
            />
            {sources.length ? (
              <EvidenceList sources={sources} />
            ) : (
              <InlineEmpty>No consulted sources for this message.</InlineEmpty>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function EvidenceList({ sources }: { sources: readonly AgentSource[] }) {
  // A source opens in the chat this Activity tab belongs to.
  const sessionId = useWorkItemSessionId()
  const navigation = useUiNavigation({
    sessionId,
    sessionProjectId: (requestedSessionId) =>
      useChatStore.getState().allSessions.find((session) => session.id === requestedSessionId)
        ?.projectId ?? null,
  })
  return (
    <div className="mt-3 space-y-0.5">
      {sources.map((source) => (
        <SourceRow key={`${source.kind}:${source.uri}`} source={source} navigation={navigation} />
      ))}
    </div>
  )
}

function SectionHeading({
  id,
  icon: Icon,
  title,
  meta,
}: {
  id: string
  icon: typeof History
  title: string
  meta: string
}) {
  return (
    <div className="flex items-center gap-2 text-text-soft">
      <Icon className="size-3.5 text-text-faint" />
      <h2 id={id} className="text-sm font-medium text-text-strong">
        {title}
      </h2>
      <span className="text-xs text-text-faint">·</span>
      <span className="font-variant-numeric-tabular text-xs text-text-faint">{meta}</span>
    </div>
  )
}

function InlineEmpty({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-xs leading-relaxed text-text-faint">{children}</p>
}

/**
 * Checkpoint-browsing bar: position among tool-bearing messages + step controls.
 * Stepping re-points the focus store, so you can walk a long run's action groups
 * without scrolling the chat back to each one. `pin` freezes the tab on the
 * current message (the chat scroll tracker stops re-pointing it); `jump` scrolls
 * the chat transcript back to the focused message (reverse link).
 */
function ReplayNavBar({
  nav,
  pinned,
  onPrev,
  onNext,
  onTogglePin,
  onJump,
}: {
  nav: ReturnType<typeof computeReplayNav>
  pinned: boolean
  onPrev: () => void
  onNext: () => void
  onTogglePin: () => void
  onJump: () => void
}) {
  const hasFocus = nav.position > 0
  return (
    <WorkbenchToolbar aria-label="Message replay navigation">
      <span className="text-xs tabular-nums text-text-soft">
        {nav.total > 0 ? `Message ${nav.position} of ${nav.total} with tools` : 'No tool activity'}
      </span>
      <WorkbenchToolbarSection align="end" spacing="compact" aria-label="Replay navigation actions">
        <IconButton
          size="sm"
          onClick={onJump}
          disabled={!hasFocus}
          aria-label="Scroll chat to this message"
          tooltip="Scroll chat to this message"
        >
          <CornerUpLeft className="size-4" />
        </IconButton>
        <IconButton
          size="sm"
          onClick={onTogglePin}
          className={pinned ? 'text-foreground' : undefined}
          aria-label={pinned ? 'Unpin (follow chat scroll)' : 'Pin to this message'}
          aria-pressed={pinned}
          tooltip={pinned ? 'Unpin — follow chat scroll' : 'Pin to this message'}
        >
          {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        </IconButton>
        <IconButton
          size="sm"
          onClick={onPrev}
          disabled={!nav.prevId}
          aria-label="Previous message with tools"
          tooltip="Previous message with tools"
        >
          <ChevronUp className="size-4" />
        </IconButton>
        <IconButton
          size="sm"
          onClick={onNext}
          disabled={!nav.nextId}
          aria-label="Next message with tools"
          tooltip="Next message with tools"
        >
          <ChevronDown className="size-4" />
        </IconButton>
      </WorkbenchToolbarSection>
    </WorkbenchToolbar>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <StateNotice icon={History} title="No message selected" body={children} />
}
