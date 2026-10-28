import { useCallback, useEffect, useRef, useState } from 'react'
import {
  adaptiveDebounceMs,
  pushCadenceSample,
  type AdaptiveDebounceBounds,
} from '@/shared/lib/adaptiveDebounce'
import type { InlineCompletionSurfaceId } from '@localixai/api/client'
import {
  abandonSuggestions,
  registerSuggestProvider,
  requestSuggestions,
  subscribeSuggestions,
} from '@/shared/api/suggestHub'
import type { SuggestOffer } from '@/shared/api/suggestCore'
import { useLatestRef } from '@/shared/lib/useLatestRef'
import { recordInlineAssistMetric } from '@/shared/lib/inlineAssistMetrics'

/** Short adaptive pause; the hub supersedes obsolete work and reuses cached answers. */
export const INLINE_COMPLETION_DEBOUNCE_BOUNDS: AdaptiveDebounceBounds = {
  minMs: 150,
  maxMs: 350,
  defaultMs: 350,
}
const INLINE_COMPLETION_RETRY_MS = 30_000

// Only transient failures get bounded retries. Empty answers never retry on a timer.
import {
  planInlineCompletionRetry,
  inlineCompletionKey,
  canRequestInlineCompletion,
  projectInlineCompletion,
  projectInlineCompletionDelivery,
  inlineCompletionAcceptance,
  shouldRetryInlineCompletion,
  type InlineCompletionRetryBudget,
  type InlineCompletionController,
  type ResolvedInlineCompletion,
} from './inlineCompletionPolicy'
export * from './inlineCompletionPolicy'

interface UseInlineCompletionInput<TPayload> {
  /** Core's own id, or a mini app's namespaced one. */
  surface: InlineCompletionSurfaceId
  sessionId: string | null
  value: string
  setValue: (value: string) => void
  payload: TPayload
  /** Changes whenever server-resolved context may have changed. */
  contextKey: string
  enabled: boolean
  /** Surface-specific activity gate (not streaming, no menu, not generating, …). */
  active: boolean
  focused: boolean
  caretAtEnd: boolean
  debounceMs?: number
}

/**
 * Shared lifecycle for every text-input completion consumer: registration with
 * the one-call hub, debounce, cache/in-flight reuse, stale-result protection,
 * retry, dismissal, and Tab/Escape behavior. Surfaces provide only typed payload
 * plus a context key; they do not own transport or completion state machines.
 */
export function useInlineCompletion<TPayload>({
  surface,
  sessionId,
  value,
  setValue,
  payload,
  contextKey,
  enabled,
  active,
  focused,
  caretAtEnd,
  debounceMs,
}: UseInlineCompletionInput<TPayload>): InlineCompletionController {
  // Typing cadence for the adaptive debounce. Keyed on the value itself so a
  // repeated effect run (StrictMode, an unrelated re-render) cannot fabricate a
  // zero-length gap and drag the median down.
  /** Retry attempts already spent on the current draft (see planInlineCompletionRetry). */
  const retryBudgetRef = useRef<InlineCompletionRetryBudget | null>(null)
  const cadenceRef = useRef<readonly number[]>([])
  const manualRequestRef = useRef(false)
  const [composing, setComposing] = useState(false)
  const lastValueRef = useRef<{ value: string; at: number } | null>(null)
  useEffect(() => {
    const previous = lastValueRef.current
    const now = Date.now()
    lastValueRef.current = { value, at: now }
    if (!previous || previous.value === value) return
    cadenceRef.current = pushCadenceSample(cadenceRef.current, now - previous.at)
  }, [value])

  const eligible = enabled && active && focused && caretAtEnd && !composing && Boolean(sessionId)
  const key = inlineCompletionKey(sessionId, surface, contextKey, value)
  const [resolved, setResolved] = useState<ResolvedInlineCompletion | null>(null)
  // Both accepting and dismissing are terminal for the current value. Accepting
  // blocks the resulting value, so the newly appended text cannot immediately
  // trigger another completion. A manual edit or context change creates a new
  // key and naturally enables completion again.
  const [blockedKey, setBlockedKey] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const canComplete = canRequestInlineCompletion(eligible, key, blockedKey)

  // A single stable registration reads the latest render state. The hub gathers
  // all eligible surfaces before sending, so chat + commit share one model call.
  const offer: SuggestOffer | null =
    canComplete && sessionId
      ? {
          sessionId,
          key,
          payload,
        }
      : null
  const offerRef = useLatestRef(offer)
  useEffect(() => registerSuggestProvider(surface, () => offerRef.current), [offerRef, surface])

  // A call triggered by another surface still carries this surface's result.
  // Reuse exact prefix typing; reject divergent drafts and changed sessions/context.
  useEffect(
    () =>
      subscribeSuggestions((delivery) => {
        const current = offerRef.current
        if (!current || delivery.sessionId !== current.sessionId) return
        const projected = projectInlineCompletionDelivery(
          delivery.keys[surface],
          current.key,
          delivery.result[surface] ?? '',
        )
        if (projected) {
          recordInlineAssistMetric('input', 'shown')
          setResolved({
            key: current.key,
            sessionId: current.sessionId,
            surface,
            contextKey,
            baseValue: projected.baseValue,
            suffix: projected.suffix,
          })
        }
      }),
    [contextKey, offerRef, surface],
  )

  const projection = projectInlineCompletion(resolved, {
    sessionId,
    surface,
    contextKey,
    value,
  })
  const suggestion = canComplete ? projection.suggestion : ''

  useEffect(() => {
    if (!canComplete || !sessionId || projection.covered) return

    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const scheduleRetry = () => {
      if (cancelled || retryTimer !== undefined) return
      // Spend from this draft's budget. Without it an empty reply scheduled the next
      // attempt forever, so an idle focused input kept paying for a model call.
      const { retry, budget } = planInlineCompletionRetry(retryBudgetRef.current, key)
      retryBudgetRef.current = budget
      if (!retry) return
      retryTimer = setTimeout(() => {
        if (!cancelled) setRetryNonce((nonce) => nonce + 1)
      }, INLINE_COMPLETION_RETRY_MS)
    }
    // Read cadence from the ref rather than as a dependency: every keystroke
    // already re-runs this effect through `key`, and making the delay reactive
    // would let a cadence update alone restart an otherwise-identical timer.
    const delay =
      debounceMs ?? adaptiveDebounceMs(cadenceRef.current, INLINE_COMPLETION_DEBOUNCE_BOUNDS)
    const timer = setTimeout(
      () => {
        const force = manualRequestRef.current
        manualRequestRef.current = false
        void requestSuggestions(sessionId, force).catch((error: unknown) => {
          if (shouldRetryInlineCompletion(error)) scheduleRetry()
        })
      },
      manualRequestRef.current ? 0 : delay,
    )

    return () => {
      cancelled = true
      clearTimeout(timer)
      if (retryTimer !== undefined) clearTimeout(retryTimer)
    }
  }, [canComplete, debounceMs, key, projection.covered, retryNonce, sessionId, surface])

  // Clearing the debounce timer above only stops a call that has not left yet. One already
  // in flight kept running to completion, so submitting the draft, blurring, dismissing or
  // unmounting still paid for a suggestion no surface could paint. The hub aborts on
  // SUPERSEDE, and abandonment is not a supersede — nothing newer ever arrives to trigger it.
  //
  // Both hooks below are EFFECTS, not the request effect's cleanup, and that placement is
  // load-bearing: `offerRef` is written by `useLatestRef` in an effect (a ref mutated during
  // render is unsafe under concurrent rendering), and React runs every cleanup of a commit
  // BEFORE its effects. Abandoning from a cleanup therefore re-gathered the PREVIOUS render's
  // still-eligible offer and never aborted. Declared after the offer refs, these run once the
  // refs hold the current render — verified in useInlineCompletion.dom.test.tsx.
  //
  // `abandon` is self-guarding (it aborts only when nothing offers), so a keystroke commit
  // passes through it untouched and a second surface still waiting is never stranded.
  useEffect(() => {
    if (canComplete || !sessionId) return
    abandonSuggestions(sessionId)
  }, [canComplete, sessionId])
  useEffect(
    () => () => {
      // Unmount, and session switch. Cleanups also run in declaration order, so the
      // registration effect above has already removed this surface's provider by now.
      // Known gap: on a session SWITCH the offer ref still holds the old session's offer,
      // so that call is aborted only if no provider claims the old session.
      if (sessionId) abandonSuggestions(sessionId)
    },
    [sessionId],
  )

  const request = useCallback((): boolean => {
    if (!eligible) return false
    manualRequestRef.current = true
    setBlockedKey(null)
    setResolved(null)
    setRetryNonce((nonce) => nonce + 1)
    return true
  }, [eligible, setBlockedKey, setResolved, setRetryNonce])

  const accept = useCallback(
    (unit: 'all' | 'word' | 'line' = 'all'): boolean => {
      if (!suggestion) return false
      const part = inlineCompletionAcceptance(suggestion, unit)
      const acceptedValue = `${value}${part}`
      recordInlineAssistMetric('input', unit === 'all' ? 'accepted' : 'partially_accepted')
      if (part === suggestion) {
        setBlockedKey(inlineCompletionKey(sessionId, surface, contextKey, acceptedValue))
        setResolved(null)
      }
      setValue(acceptedValue)
      return true
    },
    [contextKey, sessionId, setBlockedKey, setResolved, setValue, suggestion, surface, value],
  )

  const dismiss = useCallback((): boolean => {
    if (!suggestion) return false
    setBlockedKey(key)
    recordInlineAssistMetric('input', 'dismissed')
    setResolved(null)
    return true
  }, [key, setBlockedKey, setResolved, suggestion])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent): boolean => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return false
      if (event.altKey && event.code === 'Backslash') {
        if (!request()) return false
        event.preventDefault()
        return true
      }
      if (!suggestion) return false
      if (event.ctrlKey && event.key === 'ArrowRight') {
        event.preventDefault()
        return accept(event.shiftKey ? 'line' : 'word')
      }
      if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault()
        return accept()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        return dismiss()
      }
      return false
    },
    [accept, dismiss, request, suggestion],
  )

  return {
    suggestion,
    accept,
    dismiss,
    request,
    handleKeyDown,
    handleCompositionStart: () => setComposing(true),
    handleCompositionEnd: () => setComposing(false),
  }
}
