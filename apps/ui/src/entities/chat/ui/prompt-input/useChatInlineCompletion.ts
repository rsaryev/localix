import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

import {
  useInlineCompletion,
  type InlineCompletionController,
} from '@/shared/hooks/useInlineCompletion'
import { useComposerSuggestion, type ComposerSuggestion } from '@/shared/lib/composerSuggestions'

import { useChatStore } from '../../model/store'
import { chatCompletionPayload } from './chatCompletionPayload'
import {
  isFreshReplySubject,
  replyPredictionDelayMs,
  replyPredictionSubject,
} from './replyPrediction'

/**
 * Chat as one consumer of the shared inline-completion workload. The generic hook owns
 * debounce/cache/stale results/Tab/Escape; this surface supplies its typed draft, a
 * conversation-version key, and the one chat-specific rule — what an EMPTY composer may ask for.
 *
 * Two modes, by the draft:
 *   typing   continue what the person is writing — focused, caret at the end, as before;
 *   empty    predict their reply to the agent's last message (`replyPrediction.ts`): once per
 *            message, a short pause after it settles, whether or not the input has focus — so the
 *            ghost is already there when they reach it — and never for anything else.
 *
 * An extension's offered suggestion (`composerSuggestions.ts`, a Claude Code mod's
 * `$.prompt.suggest`) takes the empty box's ghost in place of a prediction.
 */
export function useChatInlineCompletion(input: {
  prompt: string
  setPrompt: (v: string) => void
  sessionId: string | null
  completionRefs: Parameters<typeof chatCompletionPayload>[1]
  enabled: boolean
  /** No menu owns the textarea and no run is streaming. */
  active: boolean
  /** A run is streaming in this session — the reply being written is watched live. */
  generating: boolean
  focused: boolean
  caretAtEnd: boolean
}) {
  const { prompt, setPrompt, sessionId, completionRefs } = input
  // Version of every server-side input used by the chat context resolver. The
  // last id catches append/branch changes; the session timestamp also catches an
  // in-place message edit or objective update where the tail id stays unchanged.
  //
  // The store SELECTOR must stay cheap: it runs on every chat-store emission, i.e.
  // once per streamed token. Serializing the ref list in there put a JSON.stringify
  // of the whole @-ref set on the token path; it now runs in a memo keyed by the
  // ref list itself, so it costs once per ref change instead. `useShallow` keeps
  // the subscription bailing on the primitives it actually watches.
  const completionRefsKey = useMemo(() => JSON.stringify(completionRefs), [completionRefs])
  const sessionContextVersion = useChatStore(
    useShallow((s) => {
      const session = s.sessions.find((x) => x.id === sessionId)
      const msgs = session?.messages
      const subject = replyPredictionSubject(session)
      return {
        lastMessageId: msgs && msgs.length > 0 ? msgs[msgs.length - 1].id : '',
        updatedAt: session?.updatedAt ?? 0,
        subjectId: subject?.id ?? '',
        subjectCreatedAt: subject?.createdAt ?? '',
      }
    }),
  )

  // Replies this window watched being written are fresh however long they took; and when each
  // was first seen SETTLED, which is what the pause before asking counts from. Both are read only
  // by the effect below, never while rendering.
  const watchedLive = useRef(new Set<string>())
  const settledAt = useRef(new Map<string, number>())
  const { lastMessageId, updatedAt, subjectId, subjectCreatedAt } = sessionContextVersion
  useEffect(() => {
    if (input.generating && lastMessageId) watchedLive.current.add(lastMessageId)
  }, [input.generating, lastMessageId])

  // The reply whose pause after settling has run out and that is still worth a call. The pause is
  // a timer and the freshness is judged when it runs out, so the clock is read in the effect and
  // the render only sees the outcome. An old conversation opened to be read never gets there.
  const [predictableId, setPredictableId] = useState<string | null>(null)
  useEffect(() => {
    if (!subjectId || input.generating) return
    const now = Date.now()
    if (!settledAt.current.has(subjectId)) settledAt.current.set(subjectId, now)
    const timer = setTimeout(
      () => {
        const subject = { id: subjectId, createdAt: subjectCreatedAt }
        if (isFreshReplySubject(subject, watchedLive.current, Date.now()))
          setPredictableId(subjectId)
      },
      replyPredictionDelayMs(settledAt.current.get(subjectId)!, now),
    )
    return () => clearTimeout(timer)
  }, [subjectId, subjectCreatedAt, input.generating])

  const empty = prompt.length === 0
  const replyMode = empty && Boolean(subjectId) && !input.generating && predictableId === subjectId

  const chatCompletionContextKey = useMemo(
    () =>
      // A reply prediction is keyed by its subject alone: a title or usage update bumping the
      // session's `updatedAt` is not a new question, and must not buy a second answer.
      replyMode
        ? JSON.stringify(['reply', subjectId, completionRefsKey])
        : JSON.stringify([lastMessageId, updatedAt, completionRefsKey]),
    [replyMode, subjectId, lastMessageId, updatedAt, completionRefsKey],
  )

  const offered = useComposerSuggestion(sessionId)
  const completion = useInlineCompletion({
    surface: 'chat',
    sessionId,
    value: prompt,
    setValue: setPrompt,
    payload: chatCompletionPayload(prompt, completionRefs),
    contextKey: chatCompletionContextKey,
    enabled: input.enabled,
    // An empty composer asks for nothing but a reply prediction, and not while one is offered.
    active: input.active && (!empty || (replyMode && !offered)),
    focused: replyMode || input.focused,
    caretAtEnd: replyMode || input.caretAtEnd,
    // The pause already ran out (see above), so the ghost is asked for at once.
    ...(replyMode ? { debounceMs: 0 } : {}),
  })
  return offered && empty ? offeredCompletion(offered, completion, setPrompt) : completion
}

/** The offered text as the ghost: Tab writes it into the box, Escape lets it go. */
export function offeredCompletion(
  offered: ComposerSuggestion,
  completion: InlineCompletionController,
  setPrompt: (value: string) => void,
): InlineCompletionController {
  const accept = () => {
    setPrompt(offered.text)
    offered.settle()
    return true
  }
  const dismiss = () => {
    offered.settle()
    return true
  }
  return {
    ...completion,
    suggestion: offered.text,
    accept,
    dismiss,
    handleKeyDown(event) {
      if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault()
        return accept()
      }
      if (event.key === 'Escape') return dismiss()
      return completion.handleKeyDown(event)
    },
  }
}
