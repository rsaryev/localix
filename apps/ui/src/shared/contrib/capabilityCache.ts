import { useEffect, useSyncExternalStore } from 'react'
import { backendClient } from '@/shared/api/client'
import type { CapabilityRuleChange, CapabilitySnapshot } from '@/shared/api/contracts'
import { parseCapabilityScope } from '@/shared/api/capabilityScope'
import { failureSentence } from '@/shared/api/internal'
import { shouldSurfaceStartupFailure, startStartupRetry } from '@/shared/lib/startupRetry'
import {
  adoptCapabilitySnapshot,
  miniAppContribSnapshot,
  miniAppCapabilityVersion,
  miniAppContribScope,
  refetchActiveMiniAppContrib,
  subscribeMiniAppContrib,
} from './enabledMiniApps'
import { trackCapabilityWrite } from './capabilityWrites'

/**
 * ONE capability document per scope, shared by every surface that reads one.
 *
 * The server already answers "what can this scope do" in a single request. The client
 * did not: the workbench singleton held the ACTIVE scope's document, Settings fetched
 * its own copy for the picked scope, and the Capabilities panel fetched skills, tools,
 * agents and MCP servers as four more requests whose contents were already inside that
 * document. Opening the panel and Settings in one scope cost the better part of ten
 * requests for one answer.
 *
 * This cache is the client half of that contract:
 *  - the ACTIVE scope is served from the workbench singleton, so surfaces looking at
 *    the project the workbench is showing cost ZERO extra requests;
 *  - any other scope is fetched once and shared by every reader of that scope, with
 *    concurrent readers joining the in-flight request rather than starting their own;
 *  - a capability mutation bumps `miniAppCapabilityVersion`, which marks every cached
 *    scope stale, so nothing can serve a document from before a toggle.
 *
 * Entity BODIES are deliberately not here: a skill's content, a panel's or a view's
 * HTML are read when that entity is opened. The catalog is one document; the bodies
 * are not part of it.
 */

export interface CapabilityCacheEntry {
  /** null until this scope has a complete document — never a half-populated stand-in. */
  snapshot: CapabilitySnapshot | null
  loading: boolean
  /** Set only once the dense startup retries are exhausted (see startupRetry). */
  error: string | null
}

interface ScopeState extends CapabilityCacheEntry {
  /** The contribution version this document was loaded at; anything older is stale. */
  loadedVersion: number
  stop: (() => void) | null
}

const PENDING: CapabilityCacheEntry = { snapshot: null, loading: true, error: null }
const IDLE: CapabilityCacheEntry = { snapshot: null, loading: false, error: null }

const scopes = new Map<string, ScopeState>()
const listeners = new Set<() => void>()
/** Per-scope entries handed to readers; rebuilt only when that scope changes. */
const views = new Map<string, CapabilityCacheEntry>()
// The active scope's entry, memoized on the document it wraps. `useSyncExternalStore`
// re-renders forever if its getSnapshot returns a fresh object each call, so every
// path through the reader below must hand back the SAME entry until something moves.
let activeView: CapabilityCacheEntry = IDLE
let cacheRevision = 0
const generations = new Map<string, number>()

function notify(): void {
  for (const listener of listeners) listener()
}

function setScope(scope: string, next: Partial<ScopeState>): void {
  const current = scopes.get(scope)
  const merged: ScopeState = {
    snapshot: null,
    loading: false,
    error: null,
    loadedVersion: -1,
    stop: null,
    ...current,
    ...next,
  }
  scopes.set(scope, merged)
  views.set(scope, { snapshot: merged.snapshot, loading: merged.loading, error: merged.error })
  notify()
}

/** The workbench singleton's document when it describes exactly this scope. */
/**
 * `scope` is the one the workbench singleton is loading right now. Its document is on its way
 * through the singleton; fetching it here too was a second request for the same answer.
 */
function awaitingActiveDocument(scope: string): boolean {
  const active = miniAppContribScope()
  if (active === undefined || miniAppContribSnapshot().document) return false
  const { projectId, agentId } = parseCapabilityScope(scope)
  return !agentId && (projectId ?? null) === active
}

function activeDocumentFor(scope: string): CapabilitySnapshot | null {
  const document = miniAppContribSnapshot().document
  if (!document) return null
  // An agent scope is never the workbench's: the singleton follows the open project, so a
  // document whose `agentId` is set could only match by accident.
  const { projectId, agentId } = parseCapabilityScope(scope)
  return document.scope.projectId === (projectId ?? '') && document.scope.agentId === agentId
    ? document
    : null
}

/**
 * What is known about `scope` right now. PURE — it starts nothing, caches nothing, and
 * returns a stable reference until the underlying state changes, because this is what
 * `useSyncExternalStore` reads on every render.
 */
export function peekCapabilities(scope: string, enabled = true): CapabilityCacheEntry {
  if (!enabled) return IDLE
  const active = activeDocumentFor(scope)
  if (active) {
    if (activeView.snapshot !== active)
      activeView = { snapshot: active, loading: false, error: null }
    return activeView
  }
  return views.get(scope) ?? PENDING
}

/**
 * Ensure `scope` has a document at the current contribution version, starting at most
 * one request for it. Called from an effect — never during render.
 */
export function ensureCapabilities(scope: string): void {
  if (activeDocumentFor(scope) || awaitingActiveDocument(scope)) return
  const version = miniAppCapabilityVersion()
  const state = scopes.get(scope)
  // Already current, or already loading for this very version: nothing to start. An
  // invalidation sets `loadedVersion` to -1, so it always falls through to a reload.
  if (state?.loadedVersion === version && (state.snapshot || state.error || state.loading)) return

  state?.stop?.()
  const generation = (generations.get(scope) ?? 0) + 1
  generations.set(scope, generation)
  // Keep any previous document visible while the reload runs: a stale answer still
  // describes this scope, and blanking it would flash an empty list on every toggle.
  const stop = startStartupRetry(async (failureIndex) => {
    try {
      const next = await backendClient.fetchCapabilitySnapshot(parseCapabilityScope(scope))
      if (generations.get(scope) !== generation) return true
      setScope(scope, { snapshot: next, loading: false, error: null, loadedVersion: version })
      return true
    } catch (error) {
      if (generations.get(scope) !== generation) return true
      if (shouldSurfaceStartupFailure(failureIndex)) {
        setScope(scope, {
          loading: false,
          error: failureSentence(error, 'The capabilities of this scope could not be loaded.'),
          loadedVersion: version,
        })
      }
      return false
    }
  })
  setScope(scope, { loading: true, error: null, loadedVersion: version, stop })
}

/**
 * Change what a scope permits, and install the document the server answers with.
 *
 * This is the ONLY capability mutation path in the client. A plugin, an agent, an MCP
 * server, one of its tools, a builtin tool, a skill — every one of them is the same request
 * carrying the same shape of rule, and its response IS the new state, so nothing here
 * re-reads what it just changed.
 *
 * Changes are applied together: one screen can flip several switches into a single
 * request, and the scope cannot come to rest between two intended states.
 */
export function applyCapabilityRules(
  scope: string,
  changes: CapabilityRuleChange[],
): Promise<CapabilitySnapshot> {
  // Registered HERE, not at the call sites. The barrier the send path waits on used to
  // be opt-in per caller, so a switch added later could quietly skip it and let a run
  // assemble before the write landed. One writer, one registration, nothing to forget.
  return trackCapabilityWrite(scope || null, () => sendRuleChanges(scope, changes))
}

async function sendRuleChanges(
  scope: string,
  changes: CapabilityRuleChange[],
): Promise<CapabilitySnapshot> {
  const next = await backendClient.applyCapabilityRules({
    ...parseCapabilityScope(scope),
    changes,
  })
  // The workbench's own scope goes through the singleton, so the rail, the capability
  // gates and the mini app UI all converge from this one document. Any other scope —
  // Settings pointed at a project that is not open — lands in this cache instead.
  const adopted = await adoptCapabilitySnapshot(next)
  if (!adopted) {
    const current = scopes.get(scope)?.snapshot
    // Revision, not arrival order: two rapid toggles can answer out of order, and the
    // older answer describes a world that no longer exists.
    if (!current || next.revision >= current.revision) {
      setScope(scope, {
        snapshot: next,
        loading: false,
        error: null,
        loadedVersion: miniAppCapabilityVersion(),
      })
    }
  }
  return next
}

/**
 * Re-read `scope` now — a manual retry, or a mutation whose effect this document has
 * to reflect.
 *
 * It RELOADS rather than merely forgetting. Dropping the entry would leave readers
 * holding `null` until something happened to call `ensureCapabilities` again, and
 * nothing would: their effects only re-run when the scope or the contribution version
 * changes, and an invalidation moves neither. The previous document stays on screen
 * while the reload runs, so a toggle does not blank the list it is toggling.
 */
export function invalidateCapabilities(scope: string): void {
  const state = scopes.get(scope)
  state?.stop?.()
  if (state) scopes.set(scope, { ...state, loadedVersion: -1, stop: null })
  // The ACTIVE scope is not served from this cache — it reads the workbench singleton —
  // and `ensureCapabilities` returns early for exactly that reason. So invalidating it
  // here reloaded nothing, and a write that does not answer with a snapshot left the list
  // stale: duplicating an agent wrote the file, refreshed, and showed the old roster until
  // something unrelated happened to republish. A toggle never hit this because it adopts
  // the document the server hands back.
  if (activeDocumentFor(scope)) void refetchActiveMiniAppContrib()
  ensureCapabilities(scope)
  notify()
}

/** Mark every scope stale; only mounted readers re-fetch their scope. */
export function invalidateAllCapabilities(): void {
  for (const [scope, state] of scopes) {
    state.stop?.()
    generations.set(scope, (generations.get(scope) ?? 0) + 1)
    scopes.set(scope, { ...state, loadedVersion: -1, stop: null })
  }
  cacheRevision++
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // The active scope is served from the workbench singleton, so its publishes are
  // this cache's changes too.
  const stopContrib = subscribeMiniAppContrib(listener)
  return () => {
    listeners.delete(listener)
    stopContrib()
  }
}

/**
 * The capability document of `scope`, converged live.
 *
 * `enabled` false parks the hook without reading anything — for a panel that has not
 * been opened yet, so an unopened surface costs no request at all.
 */
export function useCapabilities(scope: string, enabled = true): CapabilityCacheEntry {
  const version = useSyncExternalStore(
    subscribeMiniAppContrib,
    miniAppCapabilityVersion,
    miniAppCapabilityVersion,
  )
  const invalidation = useSyncExternalStore(
    subscribe,
    () => cacheRevision,
    () => 0,
  )
  const entry = useSyncExternalStore(
    subscribe,
    () => peekCapabilities(scope, enabled),
    () => (enabled ? PENDING : IDLE),
  )
  useEffect(() => {
    if (enabled) ensureCapabilities(scope)
    // `version` is a dependency, not a value read here: a capability mutation bumps it,
    // and this scope's document has to be re-read at the new version.
  }, [scope, enabled, version, invalidation])
  return entry
}

/** Test seam: forget every cached scope WITHOUT starting a replacement read. */
export function __resetCapabilityCache(): void {
  for (const state of scopes.values()) state.stop?.()
  scopes.clear()
  generations.clear()
  views.clear()
  activeView = IDLE
  notify()
}
