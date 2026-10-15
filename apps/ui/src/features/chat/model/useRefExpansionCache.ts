/**
 * Scope-namespaced expansion cache for composer @-references: the link-time
 * size preflight (`sizeOnly`) plus the in-flight set the chips render as pending.
 */
import { useCallback, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import type { ContextRefExpansion } from '@/shared/api/contracts'
import { toWireRef, type ParsedContextRef } from '@localixai/api/context-refs'

export interface RefExpansionScope {
  /** For a composer with no session yet — the project whose directory refs resolve in. */
  projectId: string | null
  /**
   * The sending session. The SERVER resolves the directory its refs expand in (ownership
   * check, then the session-cwd rule) and scopes `@call:` lookups to its transcript. The
   * client never sends a root id: computing the root here could disagree with the runtime's.
   */
  sessionId: string | null
}

export function useRefExpansionCache(scope: RefExpansionScope) {
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

  return { cache, pendingKeys, scoped, expansionFor, fetchRefs, hasScope }
}
