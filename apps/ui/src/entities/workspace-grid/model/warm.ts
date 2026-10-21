// Bounded keep-alive bookkeeping for the per-session grid. Switching sessions
// keeps a small MRU of recently-focused scopes "warm" — their last-active tab in
// each group stays mounted (hidden) so switching back is instant, no remount.
// GLOBAL owns its own bounded per-group MRU on top, shared by every active session.
// Pure + React-free; the store threads these through its action wrappers and
// GridView reads `scopeActiveTab` to decide which background bodies to keep.
import { type ScopeId, GLOBAL_SCOPE } from './scope'

/** How many SESSION scopes stay warm at once (GLOBAL is always warm on top). Older
 *  sessions fall out of the set and remount on return — caps the live body count. */
export const WARM_LIMIT = 3

/** How many tabs per (scope, group) stay warm. This applies equally to session
 *  tabs and GLOBAL contributed workbenches; beyond this
 *  MRU depth a return remounts as before, bounding DOM and live resource usage. */
export const TAB_WARM_LIMIT = 3

/** The recently-active tab ids per (scope, group), most-recent FIRST — `[0]` is the
 *  remembered active (what a backgrounded session shows on return), the rest are the
 *  session's own warm-hidden bodies. Sparse: only groups the user focused appear. */
export type ScopeActiveTab = Record<ScopeId, Record<string, string[]>>

/** Move `scope` to the front of the warm MRU, drop the oldest past WARM_LIMIT.
 *  GLOBAL is never counted/evicted (its tabs ride the active scope anyway). */
export function bumpWarm(warm: ScopeId[], scope: ScopeId): ScopeId[] {
  if (scope === GLOBAL_SCOPE) return warm
  const next = [scope, ...warm.filter((s) => s !== scope && s !== GLOBAL_SCOPE)]
  return next.slice(0, WARM_LIMIT)
}

/** Remember `tabId` as the newest of (`scope`, `leafId`)'s recent tabs — front of the
 *  MRU, deduped, capped at {@link TAB_WARM_LIMIT}. Same ref when already newest. */
export function recordScopeActive(
  map: ScopeActiveTab,
  scope: ScopeId,
  leafId: string,
  tabId: string,
): ScopeActiveTab {
  const prev = map[scope]?.[leafId] ?? []
  if (prev[0] === tabId) return map
  const next = [tabId, ...prev.filter((t) => t !== tabId)].slice(0, TAB_WARM_LIMIT)
  return { ...map, [scope]: { ...map[scope], [leafId]: next } }
}

/** Drop a closed tab from every scope's MRU — a closed body must not stay warm (or
 *  come back as the remembered active). Same ref when the tab appears nowhere. */
export function dropTabFromScopeActive(map: ScopeActiveTab, tabId: string): ScopeActiveTab {
  let changed = false
  const next: ScopeActiveTab = {}
  for (const [scope, groups] of Object.entries(map)) {
    const ng: Record<string, string[]> = {}
    for (const [leafId, ids] of Object.entries(groups)) {
      const kept = ids.filter((t) => t !== tabId)
      if (kept.length !== ids.length) changed = true
      if (kept.length > 0) ng[leafId] = kept
    }
    next[scope] = ng
  }
  return changed ? next : map
}

/** Keep only the remembered-tab entries for scopes in `keep` (the warm set + the
 *  active scope + GLOBAL); a scope evicted from the warm MRU remounts its tabs on
 *  return anyway, so its entry is dead weight. Bounds the map across a long session
 *  (without this it accreted one entry per session ever focused + per `@global`).
 *  Returns the same ref when nothing is pruned, so subscribers don't churn. */
export function pruneScopeActive(map: ScopeActiveTab, keep: Iterable<ScopeId>): ScopeActiveTab {
  const keepSet = new Set(keep)
  const kept = Object.keys(map).filter((k) => keepSet.has(k))
  if (kept.length === Object.keys(map).length) return map
  const next: ScopeActiveTab = {}
  for (const k of kept) next[k] = map[k]
  return next
}

/** Drop a whole scope from the warm set + its remembered tabs (session closed). */
export function forgetScope(
  warm: ScopeId[],
  map: ScopeActiveTab,
  scope: ScopeId,
): { warm: ScopeId[]; map: ScopeActiveTab } {
  if (!(scope in map) && !warm.includes(scope)) return { warm, map }
  const next = { ...map }
  delete next[scope]
  return { warm: warm.filter((s) => s !== scope), map: next }
}
