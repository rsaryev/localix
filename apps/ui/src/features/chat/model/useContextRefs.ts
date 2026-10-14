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
import { backendClient } from '@/shared/api/client'
import type { ContextRefExpansion } from '@/shared/api/contracts'
import {
  classifyExpansionBudget,
  parseContextRefs,
  toWireRef,
  totalExpansionChars,
  type ExpansionBudget,
  type ParsedContextRef,
} from '@localixai/api/context-refs'
import type { MessageContextBinding } from '@/shared/api/contracts'
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

/** Local chip expansion for a pinned (inline-content) ref — its content IS the ref,
 *  so the size is known without a server round-trip. */
function inlineExpansion(ref: ParsedContextRef): ContextRefExpansion {
  const content = ref.content ?? ''
  return {
    raw: ref.raw,
    ok: true,
    content,
    chars: content.length,
    ...(ref.language ? { language: ref.language } : {}),
  }
}

const FETCH_DEBOUNCE_MS = 400

export interface ContextRefChip {
  ref: ParsedContextRef
  expansion: ContextRefExpansion | null
  /** True while the expansion is being fetched. */
  pending: boolean
  /** True for a structured (pinned, token-less) ref — the chip row renders ONLY
   *  these; a typed text token's representation is its inline highlight pill. */
  pinned: boolean
  /** True for an AMBIENT auto-link chip — derived from an open editor tab, re-arms
   *  after send; × dismisses auto-linking for that tab. */
  auto?: boolean
}

/** One ambient (tab-derived) auto-link: the ref + how to dismiss its source tab. */
export interface AutoRefInput {
  ref: ParsedContextRef
  /** Dismiss auto-linking for the source tab (the chip's ×). */
  dismiss: () => void
}

const NO_AUTOS: readonly AutoRefInput[] = []

/** Dismiss raw ambient sources one by one; duplicate ref keys can belong to
 * different tabs, so this must never deduplicate before invoking callbacks. */
export function dismissAllAutoRefs(autos: readonly AutoRefInput[]): void {
  for (const auto of autos) auto.dismiss()
}

export interface UseContextRefsResult {
  /** Included (non-removed) refs with their expansion state — drives the chip row. */
  chips: ContextRefChip[]
  /** Total expanded chars across included refs (known so far). */
  totalChars: number
  budget: ExpansionBudget
  /** Human message for the warn/block chip. */
  budgetMessage: string | null
  /** How many refs the 20-per-message wire cap will drop at send (0 = none). */
  droppedCount: number
  /** The pinned (token-less, drag-added) refs — lets the composer treat a
   *  snippet-only draft as sendable and derive a fallback message text. */
  pinnedRefs: ParsedContextRef[]
  /** The chips the user linked, as references grounding the composer's Tab suggestion. */
  completionRefs: ReturnType<typeof inlineCompletionReferences>
  /** Exclude a text ref from expansion / remove a pinned ref (chip × button). */
  removeRef: (key: string) => void
  /**
   * Remove every context contribution from this draft in one action. Prompt
   * text stays intact; parsed @-tokens are excluded from the send, structured
   * pins are dropped, and every ambient source tab is dismissed.
   */
  clearAllRefs: () => void
  /**
   * Add a STRUCTURED (token-less) ref — e.g. a `snippet` dragged from the SQL Output
   * log. It carries its own inline content, so it rides the send without a prompt
   * token. Re-adding the same key REPLACES it (refreshes the captured content).
   */
  addPinnedRef: (ref: ParsedContextRef) => void
  /** Drop all pinned refs, or only the keys owned by one submitted draft. */
  clearPinnedRefs: (keys?: readonly string[]) => void
  /**
   * Budget preflight for a send: fetches sizes for any not-yet-expanded TEXT refs
   * (dry run — the server re-expands fresh at send time), unions the pinned
   * (inline-content) refs, and returns the wire refs to attach. Returns null when
   * the budget blocks the send; an empty array when there are no refs at all.
   */
  refsForSend: (text: string) => Promise<MessageContextBinding[] | null>
  /** Budget and materialize an explicit plugin action's context without staging chips/text. */
  bindingsForSend: (
    bindings: readonly MessageContextBindingDraft[],
  ) => Promise<MessageContextBinding[] | null>
}

interface Scope {
  /** For a composer with no session yet — the project whose directory refs resolve in. */
  projectId: string | null
  /**
   * The sending session. The SERVER resolves the directory its refs expand in (ownership
   * check, then the session-cwd rule) and scopes `@call:` lookups to its transcript. The
   * client never sends a root id: computing the root here could disagree with the runtime's.
   */
  sessionId: string | null
}

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

  const scopeKey = `${scope.projectId ?? ''}|${scope.sessionId ?? ''}`
  const hasScope = Boolean(scope.sessionId || scope.projectId)

  // Expansion cache + in-flight set held in state so render reads them without
  // touching refs. Keys are scope-namespaced (`scopeKey\0refKey`) so a working-dir
  // change naturally invalidates lookups — no reset effect, stale entries stay inert.
  const [cache, setCache] = useState<Map<string, ContextRefExpansion>>(() => new Map())
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(() => new Set())
  const scoped = useCallback((refKey: string) => `${scopeKey}\x00${refKey}`, [scopeKey])
  const expansionFor = useCallback(
    (refKey: string) => cache.get(`${scopeKey}\x00${refKey}`) ?? null,
    [cache, scopeKey],
  )

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

  // Fetch + cache the given refs; resolves with the freshly-fetched entries
  // (scope-namespaced keys) so callers can read results without a stale closure.
  const fetchRefs = useCallback(
    async (toFetch: ParsedContextRef[]): Promise<Map<string, ContextRefExpansion>> => {
      const fetched = new Map<string, ContextRefExpansion>()
      if (toFetch.length === 0 || !hasScope) return fetched
      const keys = toFetch.map((r) => scoped(r.key))
      setPendingKeys((prev) => {
        const next = new Set(prev)
        for (const k of keys) next.add(k)
        return next
      })
      try {
        const response = await backendClient.expandContextRefs({
          projectId: scope.projectId ?? undefined,
          sessionId: scope.sessionId ?? undefined,
          // Use the shared wire mapper (same as the send path) so EVERY registry
          // field rides along — a hand-built subset silently drops new fields like
          // `uri`, which made every @resource: chip preview as ok:false / FAILED.
          refs: toFetch.map(toWireRef),
          // Link-time preflight: a CHEAP size estimate only (chip label + budget
          // gate). The one authoritative, full, fresh expansion happens at send.
          sizeOnly: true,
        })
        const byRaw = new Map(response.expansions.map((e) => [e.raw, e]))
        for (const ref of toFetch) {
          fetched.set(
            scoped(ref.key),
            byRaw.get(ref.raw) ?? {
              raw: ref.raw,
              ok: false,
              chars: 0,
              error: 'Reference preview returned no result',
            },
          )
        }
      } catch (error) {
        // A failed preflight is still a terminal preview result for this
        // scope+ref. Leaving it uncached makes the effect below retry every
        // FETCH_DEBOUNCE_MS forever (notably on a deterministic 400), flooding
        // the local API and keeping the startup UI in a render/request loop.
        // Send-time expansion remains authoritative and retries independently.
        const message = error instanceof Error ? error.message : 'Reference preview failed'
        for (const ref of toFetch) {
          fetched.set(scoped(ref.key), {
            raw: ref.raw,
            ok: false,
            chars: 0,
            error: message,
          })
        }
      } finally {
        if (fetched.size > 0) {
          setCache((prev) => {
            const next = new Map(prev)
            for (const [k, v] of fetched) next.set(k, v)
            return next
          })
        }
        setPendingKeys((prev) => {
          const next = new Set(prev)
          for (const k of keys) next.delete(k)
          return next
        })
      }
      return fetched
    },
    [hasScope, scope.projectId, scope.sessionId, scoped],
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
  const manualBudget = hasAnyRef ? classifyExpansionBudget(manualChars, contextTokens) : 'ok'
  const combinedBudget = hasAnyRef ? classifyExpansionBudget(totalChars, contextTokens) : 'ok'
  // An ambient overflow becomes a warning because send-time admission sheds those
  // refs. Only deliberate refs may hard-block the send button.
  const budget = manualBudget === 'block' ? 'block' : combinedBudget === 'ok' ? 'ok' : 'warn'
  const budgetMessage =
    manualBudget === 'block'
      ? `Manual references expand to ~${Math.round(manualChars / 1000)}k chars — over half the model's context window. Remove some references or narrow line ranges.`
      : combinedBudget === 'block'
        ? `References expand to ~${Math.round(totalChars / 1000)}k chars — oversized ambient tabs will be omitted automatically.`
        : combinedBudget === 'warn'
          ? `References expand to ~${Math.round(totalChars / 1000)}k chars (>25% of the context window).`
          : null

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
    setPinnedRefs((prev) => (prev.length === 0 ? prev : []))
    setExcluded((prev) => {
      const next = new Set(prev)
      for (const ref of refs) next.add(ref.key)
      return next.size === prev.size ? prev : next
    })
  }, [autos, refs])

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
