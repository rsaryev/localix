import { lazy, Suspense, type ReactNode, type RefObject } from 'react'
import { ArrowDown } from 'lucide-react'

import { Button } from '@localixai/kit/button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import type { Message } from '@/shared/api/contracts'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'
import { ForeignTranscriptContext } from './tool-parts/foreignTranscriptContext'

const LazyMessageList = lazy(async () => {
  const module = await import('./MessageList')
  return { default: module.MessageList }
})

const LazyMessageSearch = lazy(async () => {
  const module = await import('./MessageSearch')
  return { default: module.MessageSearch }
})

/** The scroll instance a transcript is driven by — owned by the caller, since a surface usually
 *  has other things (a composer, auto-scroll triggers) that need the same one. */
export interface TranscriptScroll {
  scrollRef: RefObject<HTMLDivElement | null>
  showScrollToBottom: boolean
  scrollToBottom: () => void
  forceScrollToBottom: (behavior?: ScrollBehavior) => void
}

export interface TranscriptViewProps {
  messages: Message[]
  /** Identity for scroll restoration, the find bar and the message-focus bus. */
  sessionId: string | null
  isFocused: boolean
  scroll: TranscriptScroll
  isGenerating?: boolean
  streamingMessageId?: string | null
  /** Distance the scroll-to-bottom pill sits above the bottom edge — a composer's height, or 12. */
  bottomOffset?: number
  /** Shown instead of the list when there are no messages. */
  empty?: ReactNode
  /** Tools in these messages are named in a foreign vocabulary → render them all generic IN/OUT. */
  foreignTools?: boolean
  /** Every mutating action is OPTIONAL: a read-only surface simply passes none, and the cards then
   *  offer nothing to click. That is how read-only is expressed — by omission, not by a flag each
   *  card would have to remember to honour. */
  onRegenerate?: () => void
  onRollback?: (messageId: string) => void
  onEdit?: (messageId: string, content: string) => void
  onSwitchBranch?: (messageId: string, index: number) => void
  onOpenThread?: (messageId: string) => void
  phaseLabel?: string
}

/**
 * THE transcript surface — the find bar, the scrolling column, the virtualized message list and the
 * scroll-to-bottom pill, as one thing.
 *
 * Extracted from `ChatSurface` rather than written beside it, and `ChatSurface` renders this. That
 * is the whole point: a second reader of a conversation (an external agent's history, an imported
 * archive, whatever comes next) gets the REAL surface — same search, same scroll behaviour, same
 * cards — instead of a lookalike that is always missing something. Every attempt at the lookalike
 * shipped a different gap.
 *
 * What a caller varies is the messages, the identity they scroll under, and which actions exist.
 * Nothing here knows where the messages came from.
 */
export function TranscriptView({
  messages,
  sessionId,
  isFocused,
  scroll,
  isGenerating = false,
  streamingMessageId,
  bottomOffset = 12,
  empty,
  foreignTools = false,
  onRegenerate,
  onRollback,
  onEdit,
  onSwitchBranch,
  onOpenThread,
  phaseLabel,
}: TranscriptViewProps) {
  const hasMessages = messages.length > 0
  const { scrollRef } = scroll

  return (
    <WorkItemSessionProvider sessionId={sessionId}>
      <ForeignTranscriptContext.Provider value={foreignTools}>
        {/* This containing block occupies only the transcript region. A caller may place a footer
            after it (for example the external-session import action); keeping the floating scroll
            control inside this region guarantees it cannot cover that footer. */}
        <div data-slot="transcript-view" className="relative flex min-h-0 flex-1 flex-col">
          {/* The find bar owns a global shortcut/store and therefore exists only in the single
              focused surface. Hidden transcripts stay mounted, but must not compete for the query
              or the active match. */}
          {hasMessages && isFocused && (
            <Suspense fallback={null}>
              <LazyMessageSearch messages={messages} sessionId={sessionId} />
            </Suspense>
          )}

          <div
            ref={scrollRef}
            data-ui-scroll-container
            // `overscroll-contain`: reaching either end of the transcript must not
            // chain the wheel into the surface behind it.
            // `@container`: the minimap rail measures the gutter against THIS width (`100cqw`), so
            // it can stop short of the scroll box instead of overflowing it sideways.
            // `virtual-scroller`: virtualized and pinned by its own follow logic — see ChatSurface.
            className="@container virtual-scroller min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin [scrollbar-gutter:stable]"
          >
            <div className="relative mx-auto flex min-h-full w-full max-w-(--chat-measure) flex-col pb-4 max-sm:max-w-full">
              {hasMessages ? (
                <Suspense
                  fallback={<LoadingHint className="flex-1">Rendering conversation…</LoadingHint>}
                >
                  <LazyMessageList
                    messages={messages}
                    isGenerating={isGenerating}
                    streamingMessageId={streamingMessageId}
                    scrollRef={scrollRef}
                    onContentSizeChange={scroll.scrollToBottom}
                    sessionId={sessionId}
                    navActive={isFocused}
                    onRegenerate={onRegenerate}
                    onRollback={onRollback}
                    onEdit={onEdit}
                    onSwitchBranch={onSwitchBranch}
                    onOpenThread={onOpenThread}
                    phaseLabel={phaseLabel}
                  />
                </Suspense>
              ) : (
                empty
              )}
            </div>
          </div>

          {scroll.showScrollToBottom && (
            <div
              data-slot="transcript-scroll-control"
              className="pointer-events-none absolute inset-x-0 z-(--z-sticky)"
              style={{ bottom: bottomOffset }}
            >
              <div className="mx-auto flex w-full max-w-(--chat-measure) justify-center px-6 max-sm:max-w-full max-sm:px-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={
                    isGenerating ? 'Scroll to latest (still generating)' : 'Scroll to bottom'
                  }
                  title={
                    isGenerating
                      ? 'Scroll to latest — new content is arriving below'
                      : 'Scroll to bottom'
                  }
                  // FORCE: this pill only exists while the reader is unpinned, so a follow-preserving
                  // call would be a no-op on the one control whose entire job is to go down.
                  onClick={() => scroll.forceScrollToBottom('smooth')}
                  className="lx-glass-trigger pointer-events-auto size-10 rounded-full"
                >
                  <ArrowDown className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </ForeignTranscriptContext.Provider>
    </WorkItemSessionProvider>
  )
}
