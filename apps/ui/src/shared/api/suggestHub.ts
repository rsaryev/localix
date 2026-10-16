/**
 * Unified inline-completion hub — the client half of the ONE-call text-input
 * pipeline. Every ghost surface triggers through here: whichever surface goes
 * idle first requests completion, the hub gathers every registered surface's
 * current context offer, and one WS `inline.complete` RPC answers all of them — so N surfaces
 * idling near-simultaneously cost one aux-model call, not N.
 *
 * Lives in `shared/api` (FSD) as the shared mediator, so same-layer feature
 * slices can each register a surface without importing each other.
 *
 * All semantics (offer gathering, in-flight dedupe, capped response cache,
 * fresh-result fan-out to surfaces that did NOT trigger the call) live in the
 * pure, tested `createSuggestHub` in `suggestCore.ts` — this module only binds
 * it to the WebSocket client. Dismissal stays SURFACE-LOCAL (each surface hides
 * its own slice; the cache entry survives for the other surface).
 */

import { backendClient } from './client'
import { completionWorkingSet } from './completionWorkingSet'
import { createSuggestHub } from './suggestCore'

const hub = createSuggestHub(
  (sessionId, surfaces, signal, references) =>
    backendClient.completeInputs(sessionId, surfaces, signal, references),
  undefined,
  undefined,
  undefined,
  () => completionWorkingSet(),
)

/**
 * Register a surface's offer provider. Returns the unregister function (call on
 * unmount). A provider returns null whenever its surface isn't idle-eligible.
 */
export const registerSuggestProvider = hub.registerProvider

/**
 * Fetch suggestions for every currently-offering surface in ONE call. Serves
 * from cache when the combined context is unchanged; joins an identical
 * in-flight request instead of double-firing.
 */
export const requestSuggestions = hub.request

/**
 * Abandon the in-flight call once no surface still wants it (blur, submit, Escape,
 * unmount, session switch). Aborts the WS RPC so the server stops the aux model
 * call rather than merely discarding its reply. A no-op while any surface is still
 * offering, so it is safe to call from a per-keystroke effect cleanup.
 */
export const abandonSuggestions = hub.abandon

/**
 * Subscribe to every FRESH result (whichever surface triggered it) — how a
 * surface consumes its slice of a request another surface fired.
 */
export const subscribeSuggestions = hub.subscribe
