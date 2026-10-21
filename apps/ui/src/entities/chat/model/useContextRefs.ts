/**
 * useContextRefs — composer @-reference state machine.
 *
 * Two channels feed the send:
 *  - TEXT refs parsed out of the prompt (hand-typed/pasted @-tokens) — their
 *    representation is the inline highlight pill in the textarea.
 *  - PINNED refs (token-less, structured) minted by the @-menu, drag/drop, or
 *    the composerBus — ANY kind; their representation is the attached-context
 *    summary and ordered popover list. A pinned key shadows an identical typed token.
 *
 * Both are pre-fetched (debounced) for sizes so the budget gate (warn ≥25% of
 * the model window, block ≥50%) reflects real content — only inline-content
 * pins (snippets) are sized locally. `refsForSend` is the budget preflight that
 * yields the structured refs the send carries. The outgoing TEXT stays exactly
 * what the user typed; the server resolves them into immutable binding contributions
 * (quiet linking — the transcript never shows expanded blocks).
 *
 * Removing a pinned chip drops the ref; "removing" a typed token means deleting
 * it from the text (the exclusion set remains for programmatic exclusion and
 * resets whenever the ref disappears from the prompt).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { forgetReviewComments } from '@/shared/lib/reviewCommentBinding'
import type { ContextRefExpansion, MessageContextBinding } from '@/shared/api/contracts'
import {
  parseContextRefs,
  totalExpansionChars,
  type ParsedContextRef,
} from '@localixai/api/context-refs'
import type { MessageContextBindingDraft } from '@localixai/plugin-sdk/ui'
import {
  droppedRefCount,
  includeAutoRefs,
  inlineCompletionReferences,
  inlineRefChars,
  isInlineContentRef,
  refsFromContextBindingDrafts,
  resolveSendRefs,
} from './sendRefs'
import { inlineExpansion, summarizeRefBudget } from './contextRefBudget'
import { useRefExpansionCache, type RefExpansionScope } from './useRefExpansionCache'
import {
  NO_AUTOS,
  dismissAllAutoRefs,
  type AutoRefInput,
  type ContextRefChip,
  type UseContextRefsResult,
} from './contextRefTypes'

export {
  dismissAllAutoRefs,
  type AutoRefInput,
  type ContextRefChip,
  type UseContextRefsResult,
} from './contextRefTypes'

const FETCH_DEBOUNCE_MS = 400

type Scope = RefExpansionScope

export function useContextRefs(
  prompt: string,
  scope: Scope,
  contextTokens: number | undefined,
  /**
   * Ambient auto-links derived from the open tabs, FRESHEST FIRST. Every one yields to a
   * manual duplicate, and the order is the tie-break between two that resolve to the same
   * ref. A list rather than one: a single slot meant whichever group happened to be
   * focused won and every other open tab was invisible to the agent.
   *
   * Must be REFERENTIALLY STABLE across renders (memoized, or the module-level empty). A
   * fresh array each render restarts the debounced preflight timer every render, and the
   * sizes would never arrive.
   */
  autos: readonly AutoRefInput[] = NO_AUTOS,
  /** Warm-hidden composers retain their draft state but must not preflight it. */
  enabled = true,
): UseContextRefsResult {
  const refs = useMemo(() => parseContextRefs(prompt), [prompt])
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  // Structured (token-less) refs added by drag/attach — e.g. a `snippet` from the SQL
  // Output log. They live OUTSIDE the prompt text (no @token), carry their own inline
  // content, and are sized locally (no server fetch). Cleared after send by the owner.
  const [pinnedRefs, setPinnedRefs] = useState<ParsedContextRef[]>(() => [])

  const { cache, pendingKeys, scoped, expansionFor, fetchRefs, hasScope } =
    useRefExpansionCache(scope)

  // Drop exclusions for refs that left the prompt — adjusting state during render
  // (the sanctioned alternative to a setState-in-effect; runs only when `refs` change).
  const [prevRefKeys, setPrevRefKeys] = useState('')
  const refKeysSig = refs.map((r) => r.key).join('\x00')
  if (prevRefKeys !== refKeysSig) {
    setPrevRefKeys(refKeysSig)
    setExcluded((prev) => {
      if (prev.size === 0) return prev
      const live = new Set(refs.map((r) => r.key))
      const next = new Set([...prev].filter((k) => live.has(k)))
      return next.size === prev.size ? prev : next
    })
  }

  // A typed token whose key is also PINNED is shadowed by the pinned ref (one
  // ref, one chip, one expansion — not two).
  const textIncluded = useMemo(() => {
    const pinnedKeys = new Set(pinnedRefs.map((r) => r.key))
    return refs.filter((r) => !excluded.has(r.key) && !pinnedKeys.has(r.key))
  }, [refs, excluded, pinnedRefs])

  // The ambient tab refs, minus any a deliberate duplicate shadows (a manual pinned ref
  // or a live typed token with the same key) and minus ambient duplicates of each other.
  const autoRefs = useMemo(
    () =>
      includeAutoRefs(
        autos.map((a) => a.ref),
        refs,
        excluded,
        pinnedRefs,
      ),
    [autos, refs, excluded, pinnedRefs],
  )
  // Which × dismisses which tab. Built from the RAW autos (not the included ones) so the
  // mapping survives a ref being shadowed and then un-shadowed.
  const dismissByKey = useMemo(() => {
    const map = new Map<string, () => void>()
    for (const a of autos) if (!map.has(a.ref.key)) map.set(a.ref.key, a.dismiss)
    return map
  }, [autos])

  // Refs WITHOUT inline content (file/session/resource/… — everything but a
  // snippet) are preflight-sized server-side exactly like text refs. Ambient
  // snippets are sized locally; ambient provider refs join the fetch so their
  // estimates feed the budget + chips.
  const pinnedFetchable = useMemo(
    () => pinnedRefs.filter((r) => !isInlineContentRef(r)),
    [pinnedRefs],
  )
  const autoFetchable = useMemo(() => autoRefs.filter((r) => !isInlineContentRef(r)), [autoRefs])
  const previewFetchable = useMemo(
    () => [...autoFetchable, ...pinnedFetchable],
    [autoFetchable, pinnedFetchable],
  )

  // Debounced pre-fetch of uncached server-sized refs — text refs AND pinned
  // non-inline refs (sizes feed the budget gate + chips). Only inline-content
  // pins (snippets) never fetch.
  useEffect(() => {
    if (!enabled || !hasScope) return
    const missing = [...textIncluded, ...previewFetchable].filter(
      (r) => !cache.has(scoped(r.key)) && !pendingKeys.has(scoped(r.key)),
    )
    if (missing.length === 0) return
    const timer = setTimeout(() => void fetchRefs(missing), FETCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [enabled, textIncluded, previewFetchable, hasScope, fetchRefs, cache, pendingKeys, scoped])

  // Auto chips first (freshest first among them), then text chips + pinned chips.
  // Server-sized refs read the expansion cache; an inline-content pin (snippet) is
  // sized locally.
  const chips: ContextRefChip[] = [
    ...autoRefs.map((ref) => ({
      ref,
      expansion: expansionFor(ref.key),
      pending: pendingKeys.has(scoped(ref.key)),
      pinned: true,
      auto: true,
    })),
    ...textIncluded.map((ref) => ({
      ref,
      expansion: expansionFor(ref.key),
      pending: pendingKeys.has(scoped(ref.key)),
      pinned: false,
    })),
    ...pinnedRefs.map((ref) =>
      isInlineContentRef(ref)
        ? { ref, expansion: inlineExpansion(ref), pending: false, pinned: true }
        : {
            ref,
            expansion: expansionFor(ref.key),
            pending: pendingKeys.has(scoped(ref.key)),
            pinned: true,
          },
    ),
  ]

  const droppedCount = droppedRefCount(textIncluded.length, pinnedRefs.length + autoRefs.length)
  const completionRefs = useMemo(
    () => inlineCompletionReferences({ pinnedRefs, textRefs: textIncluded }),
    [pinnedRefs, textIncluded],
  )

  const manualChars =
    totalExpansionChars([...textIncluded, ...pinnedFetchable], cache, scoped) +
    inlineRefChars(pinnedRefs)
  const ambientChars = totalExpansionChars(autoFetchable, cache, scoped) + inlineRefChars(autoRefs)
  const totalChars = manualChars + ambientChars
  const hasAnyRef = textIncluded.length > 0 || pinnedRefs.length > 0 || autoRefs.length > 0
  const { budget, budgetMessage } = summarizeRefBudget({
    manualChars,
    totalChars,
    hasAnyRef,
    contextTokens,
  })

  const removeRef = useCallback(
    (key: string) => {
      // An auto chip's × dismisses auto-linking for its source tab — the ref is
      // derived, so dropping the derivation (not state here) removes it. Guarded on
      // the INCLUDED auto refs: when a manual duplicate shadows one, × must remove
      // that manual ref, not silence the tab.
      if (autoRefs.some((r) => r.key === key)) {
        dismissByKey.get(key)?.()
        return
      }
      // A pinned (structured) ref is dropped outright; a text ref is excluded from
      // expansion (its token stays in the prompt as plain words). Both are idempotent:
      // a key is only ever pinned OR text, and a stray excluded key is GC'd by the
      // exclusion-reset pass above.
      setPinnedRefs((prev) =>
        prev.some((r) => r.key === key) ? prev.filter((r) => r.key !== key) : prev,
      )
      setExcluded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
      // A review comment's chip IS the comment: removing it withdraws the comment too.
      forgetReviewComments([key])
    },
    [autoRefs, dismissByKey],
  )

  const addPinnedRef = useCallback((ref: ParsedContextRef) => {
    setPinnedRefs((prev) => {
      const idx = prev.findIndex((r) => r.key === ref.key)
      if (idx === -1) return [...prev, ref]
      // Re-added with the same identity → refresh the captured content in place.
      const next = prev.slice()
      next[idx] = ref
      return next
    })
  }, [])

  const clearAllRefs = useCallback(() => {
    // Dismiss RAW autos rather than only included/deduplicated refs: two tabs can
    // publish the same target, and dismissing just the winning ref would let the
    // shadowed tab immediately reappear.
    dismissAllAutoRefs(autos)
    forgetReviewComments(pinnedRefs.map((ref) => ref.key))
    setPinnedRefs((prev) => (prev.length === 0 ? prev : []))
    setExcluded((prev) => {
      const next = new Set(prev)
      for (const ref of refs) next.add(ref.key)
      return next.size === prev.size ? prev : next
    })
  }, [autos, refs, pinnedRefs])

  const clearPinnedRefs = useCallback((keys?: readonly string[]) => {
    if (keys?.length === 0) return
    const selected = keys ? new Set(keys) : null
    setPinnedRefs((prev) => {
      if (!selected) return prev.length === 0 ? prev : []
      const next = prev.filter((ref) => !selected.has(ref.key))
      return next.length === prev.length ? prev : next
    })
  }, [])

  const refsForSend = useCallback(
    async (text: string): Promise<MessageContextBinding[] | null> => {
      const textRefs = parseContextRefs(text).filter((r) => !excluded.has(r.key))
      // Re-check autos against SEND-TIME text first: a just-typed duplicate shadows
      // one before either preflight or admission.
      const sendAutos = includeAutoRefs(
        autos.map((a) => a.ref),
        textRefs,
        excluded,
        pinnedRefs,
      )
      // Size dry-run over both channels. Manual totals can block; ambient sizes
      // are per-ref inputs so resolveSendRefs can shed only the oversized guesses.
      const manualServerSized = [...textRefs, ...pinnedFetchable]
      const sendAutoFetchable = sendAutos.filter((ref) => !isInlineContentRef(ref))
      const serverSized = [...manualServerSized, ...sendAutoFetchable]
      let knownTextChars = 0
      const autoRefChars = new Map<string, number>()
      for (const ref of sendAutos) {
        if (isInlineContentRef(ref)) autoRefChars.set(ref.key, ref.content?.length ?? 0)
      }
      if (serverSized.length > 0 && hasScope) {
        const missing = serverSized.filter((r) => !cache.has(scoped(r.key)))
        const fetched =
          missing.length > 0 ? await fetchRefs(missing) : new Map<string, ContextRefExpansion>()
        const merged = new Map(cache)
        for (const [k, v] of fetched) merged.set(k, v)
        const knownManual = manualServerSized.filter((r) => merged.has(scoped(r.key)))
        knownTextChars = totalExpansionChars(knownManual, merged, scoped)
        for (const ref of sendAutoFetchable) {
          const chars = merged.get(scoped(ref.key))?.chars
          if (chars !== undefined) autoRefChars.set(ref.key, chars)
        }
      }
      return resolveSendRefs({
        textRefs,
        pinnedRefs,
        autoRefs: sendAutos,
        knownTextChars,
        autoRefChars,
        contextTokens,
      })
    },
    [
      excluded,
      hasScope,
      fetchRefs,
      contextTokens,
      cache,
      scoped,
      pinnedRefs,
      pinnedFetchable,
      autos,
    ],
  )

  const bindingsForSend = useCallback(
    async (
      bindings: readonly MessageContextBindingDraft[],
    ): Promise<MessageContextBinding[] | null> => {
      const actionRefs = refsFromContextBindingDrafts(bindings)
      const serverSized = actionRefs.filter((ref) => !isInlineContentRef(ref))
      let knownTextChars = 0
      if (serverSized.length > 0 && hasScope) {
        const missing = serverSized.filter((ref) => !cache.has(scoped(ref.key)))
        const fetched =
          missing.length > 0 ? await fetchRefs(missing) : new Map<string, ContextRefExpansion>()
        const merged = new Map(cache)
        for (const [key, value] of fetched) merged.set(key, value)
        knownTextChars = totalExpansionChars(
          serverSized.filter((ref) => merged.has(scoped(ref.key))),
          merged,
          scoped,
        )
      }
      return resolveSendRefs({
        textRefs: [],
        pinnedRefs: actionRefs,
        autoRefs: [],
        knownTextChars,
        contextTokens,
      })
    },
    [cache, contextTokens, fetchRefs, hasScope, scoped],
  )

  return {
    chips,
    totalChars,
    budget,
    budgetMessage,
    droppedCount,
    pinnedRefs,
    completionRefs,
    removeRef,
    clearAllRefs,
    addPinnedRef,
    clearPinnedRefs,
    refsForSend,
    bindingsForSend,
  }
}
