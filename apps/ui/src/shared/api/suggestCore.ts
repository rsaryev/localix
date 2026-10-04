/**
 * Pure logic for the unified suggestion hub (`suggestHub.ts`) — offer gathering,
 * fingerprinting and the capped cache write, kept dependency-free so the
 * dedupe/cache semantics are unit-testable without the WebSocket client.
 *
 * A SURFACE — core's chat composer, or any text field a plugin contributed — registers a PROVIDER
 * that returns its current OFFER ("here is my context payload + a stable key for it"), or null when
 * the surface isn't idle-eligible right now. One request gathers every surface's offer, so a single
 * aux round-trip serves all of them; each surface keys its cache, the combined fingerprint keys in-flight
 * dedupe. The payload is opaque here: only the surface and its server-side owner know its shape.
 */

import { createBoundedCache } from '@localixai/kit/lib'
import {
  INLINE_COMPLETION_SURFACE_IDS,
  type CompletionReference,
  type InlineCompletionResult,
  type InlineCompletionSurfaceId,
} from '@localixai/api/client'

export type SuggestSurfaceId = InlineCompletionSurfaceId
/** Core's own surfaces. A contributed one joins the hub by registering, not by being listed here. */
export const SUGGEST_SURFACE_IDS = INLINE_COMPLETION_SURFACE_IDS
export type SuggestSurfacePayloads = Record<string, unknown>

export interface SuggestOffer {
  /** Session the offer belongs to — offers for other sessions are skipped. */
  sessionId: string
  /**
   * Stable context key for this offer (e.g. lastMessageId+draft for the
   * composer). Part of the combined fingerprint, so a change re-fetches and an
   * unchanged refocus is served free.
   */
  key: string
  payload: unknown
}

export type SuggestOfferProvider = () => SuggestOffer | null

export interface GatheredOffers {
  /** Per-surface payloads to send (only surfaces that offered). */
  surfaces: SuggestSurfacePayloads
  /** Combined in-flight dedupe key over the session + every offered surface's key. */
  fingerprint: string
  /** Exact per-surface offer keys used to reject stale cross-surface delivery. */
  keys: Record<string, string>
  /** How many surfaces offered (0 = nothing to ask). */
  count: number
}

/**
 * Gather the current offer of every registered surface for `sessionId`. Within a
 * surface the FIRST provider returning a non-null, session-matching offer wins.
 */
export function gatherOffers(
  providers: ReadonlyMap<SuggestSurfaceId, ReadonlySet<SuggestOfferProvider>>,
  sessionId: string,
): GatheredOffers {
  const surfaces: SuggestSurfacePayloads = {}
  const keys: Record<string, string> = {}
  const parts: string[] = []
  let count = 0
  // Core's own surfaces first, then every contributed one that registered — sorted, so the
  // fingerprint over the same set of offers is the same string whatever order they registered in.
  const ids = [
    ...SUGGEST_SURFACE_IDS.filter((id) => providers.has(id)),
    ...[...providers.keys()]
      .filter((id) => !(SUGGEST_SURFACE_IDS as readonly string[]).includes(id))
      .sort(),
  ]
  for (const id of ids) {
    for (const provider of providers.get(id) ?? []) {
      let offer: SuggestOffer | null
      try {
        offer = provider()
      } catch {
        offer = null // a broken provider must never take the whole hub down
      }
      if (!offer || offer.sessionId !== sessionId) continue
      surfaces[id] = offer.payload
      keys[id] = offer.key
      parts.push(`${id}=${offer.key}`)
      count++
      break
    }
  }
  return { surfaces, keys, fingerprint: `${sessionId}|${parts.join('|')}`, count }
}

/** Per-surface completion text keyed by surface id (`chat` / `commit`). */
export type SuggestResultMap = InlineCompletionResult

/**
 * Notified with every FRESH `request` result (after the cache write), whoever
 * triggered it — so a surface can consume the slice of a request it did NOT
 * fire. Listeners must re-validate their own surface state before painting; a
 * throwing listener never breaks the hub.
 */
export interface SuggestDelivery {
  sessionId: string
  fingerprint: string
  keys: Record<string, string>
  result: SuggestResultMap
  source: 'fresh' | 'cache'
}

export type SuggestResultListener = (delivery: SuggestDelivery) => void

export interface SuggestHub {
  /** Register a surface's offer provider; returns the unregister function. */
  registerProvider: (id: SuggestSurfaceId, provider: SuggestOfferProvider) => () => void
  /** ONE call for every currently-offering surface (cache + in-flight dedupe). */
  request: (sessionId: string, force?: boolean) => Promise<SuggestResultMap>
  /**
   * Abandon the in-flight call for `sessionId` when NO surface still wants its
   * answer — blur, submit, dismissal, unmount, a session switch. Returns whether
   * it actually aborted, so the caller can be tested and counted.
   *
   * Self-guarding by design: it re-gathers offers and aborts only at count 0. That
   * makes it safe to call from an effect cleanup that also runs on every keystroke
   * (the surface is still offering then, so nothing is cancelled) and safe while a
   * SECOND surface is still waiting on the same shared call.
   */
  abandon: (sessionId: string) => boolean
  /** Subscribe to fresh results (any trigger); returns the unsubscribe function. */
  subscribe: (listener: SuggestResultListener) => () => void
}

/**
 * The unified suggestion hub's full semantics as a pure factory over an injected
 * transport — offer gathering, response cache, in-flight dedupe, and result
 * fan-out — so `suggestHub.ts` is just this bound to the WebSocket client and
 * the whole two-surfaces-one-call contract is unit-testable.
 *
 * Two DIFFERENT reasons cancel a call, and for a while only one of them existed:
 * losing a race to a newer draft (`request`), and being abandoned because nobody
 * wants the answer anymore (`abandon`). Without the second one, submitting the composer or blurring
 * the input left an aux model call generating tokens for a suggestion that could
 * no longer be shown.
 */
export function createSuggestHub(
  send: (
    sessionId: string,
    surfaces: SuggestSurfacePayloads,
    signal: AbortSignal,
    references: readonly CompletionReference[],
  ) => Promise<SuggestResultMap>,
  cacheCap = 30,
  cacheTtlMs = 60_000,
  now: () => number = Date.now,
  /**
   * What the user has open, read at request time and sent ONCE per call for every surface in it.
   * Its identity joins the fingerprint and each cache key: the same draft beside a different
   * open file is a different question, and a cached answer to the first must not answer it.
   */
  workingSet: () => readonly CompletionReference[] = () => [],
): SuggestHub {
  const providers = new Map<SuggestSurfaceId, Set<SuggestOfferProvider>>()
  const cache = createBoundedCache<string, { result: SuggestResultMap; expiresAt: number }>({
    maxEntries: cacheCap,
  })
  const listeners = new Set<SuggestResultListener>()
  const inflight = new Map<
    string,
    { fingerprint: string; controller: AbortController; promise: Promise<SuggestResultMap> }
  >()

  const notify = (delivery: SuggestDelivery) => {
    for (const listener of listeners) {
      try {
        listener(delivery)
      } catch {
        // A broken listener must never take the hub (or the other surfaces) down.
      }
    }
  }

  return {
    registerProvider: (id, provider) => {
      let set = providers.get(id)
      if (!set) {
        set = new Set()
        providers.set(id, set)
      }
      set.add(provider)
      return () => {
        set.delete(provider)
      }
    },
    request: (sessionId, force = false) => {
      const gathered = gatherOffers(providers, sessionId)
      const { surfaces, keys, count } = gathered
      if (count === 0) return Promise.resolve({})
      const references = workingSet()
      const workingSetKey = JSON.stringify(
        references.map((reference) => [reference.kind, reference.uri ?? '', reference.token]),
      )
      const fingerprint = `${gathered.fingerprint}|${workingSetKey}`

      // One active model call per session. A newer combined draft cancels the
      // previous WS RPC, which propagates through the server AbortController to
      // the provider instead of merely hiding its eventual stale response.
      const active = inflight.get(sessionId)
      if (!force && active?.fingerprint === fingerprint) return active.promise
      if (active) {
        active.controller.abort(new DOMException('Superseded inline completion', 'AbortError'))
        inflight.delete(sessionId)
      }

      const cached: SuggestResultMap = {}
      const missing: SuggestSurfacePayloads = {}
      const surfaceCacheKey = (id: string) =>
        JSON.stringify([sessionId, id, keys[id], workingSetKey])
      for (const id of Object.keys(surfaces)) {
        const entryKey = surfaceCacheKey(id)
        const hit = force ? undefined : cache.get(entryKey)
        if (hit && hit.expiresAt > now()) Object.assign(cached, hit.result)
        else {
          cache.delete(entryKey)
          missing[id] = surfaces[id]
        }
      }
      if (Object.keys(missing).length === 0) {
        notify({ sessionId, fingerprint, keys, result: cached, source: 'cache' })
        return Promise.resolve(cached)
      }

      const controller = new AbortController()
      const promise = send(sessionId, missing, controller.signal, references)
        .then((result) => {
          if (controller.signal.aborted) return {}
          for (const id of Object.keys(missing)) {
            const suffix = result[id]
            const value = suffix ? { [id]: suffix } : {}
            const ttl = suffix ? cacheTtlMs : Math.min(cacheTtlMs, 10_000)
            cache.set(surfaceCacheKey(id), { result: value, expiresAt: now() + ttl })
          }
          const combined = { ...cached, ...result }
          notify({ sessionId, fingerprint, keys, result: combined, source: 'fresh' })
          return combined
        })
        .finally(() => {
          if (inflight.get(sessionId)?.promise === promise) inflight.delete(sessionId)
        })
      inflight.set(sessionId, { fingerprint, controller, promise })
      return promise
    },
    abandon: (sessionId) => {
      const active = inflight.get(sessionId)
      if (!active) return false
      // Someone still wants this answer — a keystroke re-running a cleanup, or a
      // second surface sharing the call. Superseding is `request`'s job, not ours.
      if (gatherOffers(providers, sessionId).count > 0) return false
      active.controller.abort(new DOMException('Abandoned inline completion', 'AbortError'))
      inflight.delete(sessionId)
      return true
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
