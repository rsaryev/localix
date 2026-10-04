/**
 * Statistics for the roster's stats view.
 *
 * The fold is cheap on the server (it reads the index the roster already filled), but it is not
 * free: `active` gates it on the stats view actually being on screen, so a warm hidden tab and the
 * sessions view both cost nothing.
 */
import { useEffect, useRef, useState } from 'react'
import { ExternalAgentsApiError, externalAgentsApi } from '../api/externalAgentsApi'
import type { ExternalAgentStats, StatsQuery } from './types'

export interface StatsState {
  stats: ExternalAgentStats | null
  loading: boolean
  error: string | null
  /** The raw text behind `error`. Event Center only, never on the line. */
  errorDetail?: string | null
}

/**
 * The stats request and the key that decides whether it must be re-issued, built ONCE from the same
 * fields.
 *
 * They used to be two expressions listing the same filters — a payload and a template-string key — with
 * nothing keeping them in step. A field present in one and missing from the other fails in opposite
 * ways: missing from the payload, the screen shows unfiltered figures while the chips look active;
 * missing from the key, changing that filter never refetches and the screen goes stale. Deriving the key
 * FROM the query makes both impossible.
 *
 * Exported because a mutation sweep found each filter here droppable with the whole suite green: the
 * only caller was a hook, and a hook needs React to run.
 */
export function statsRequest(
  providers: readonly string[],
  days: number,
  cwdPrefix: string | undefined,
  model: string | undefined,
  includeChildren: boolean,
  reloadToken: number,
): { readonly query: StatsQuery; readonly key: string } {
  const query: StatsQuery = {
    days,
    ...(providers.length > 0 ? { providers } : {}),
    ...(cwdPrefix ? { cwdPrefix } : {}),
    ...(model ? { model } : {}),
    ...(includeChildren ? { includeChildren: true } : {}),
  }
  // Sorted, so a key never changes because a field was written in another order.
  const key = Object.entries(query)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, value]) => `${field}=${String(value)}`)
    .join('&')
  return { query, key: `${key}#${reloadToken}` }
}

export function useStats(
  providers: readonly string[],
  days: number,
  reloadToken: number,
  active: boolean,
  cwdPrefix?: string,
  model?: string,
  includeChildren = false,
): StatsState {
  const [state, setState] = useState<StatsState>({ stats: null, loading: false, error: null })
  /** The request this hook already answered, so returning to the view is free. */
  const fetchedRef = useRef<string | null>(null)
  const providerKey = providers.join(',')

  useEffect(() => {
    if (!active) return
    const { query, key: request } = statsRequest(
      providerKey ? providerKey.split(',') : [],
      days,
      cwdPrefix,
      model,
      includeChildren,
      reloadToken,
    )
    if (fetchedRef.current === request) return
    fetchedRef.current = request

    setState((prev) => ({ ...prev, loading: true, error: null }))
    void externalAgentsApi
      .stats(query)
      .then((stats) => {
        // Guarded on the REQUEST rather than a per-effect flag: an effect that re-runs (a
        // visibility flip, StrictMode) would otherwise cancel the only fetch in flight and leave
        // `loading` true forever, which is exactly how the transcript pane once hung.
        if (fetchedRef.current !== request) return
        setState({ stats, loading: false, error: null })
      })
      .catch((cause: unknown) => {
        if (fetchedRef.current !== request) return
        fetchedRef.current = null
        setState({
          stats: null,
          loading: false,
          error:
            cause instanceof Error ? cause.message : 'Could not fold the agent history into stats.',
          errorDetail: cause instanceof ExternalAgentsApiError ? (cause.detail ?? null) : null,
        })
      })
  }, [active, providerKey, days, cwdPrefix, model, includeChildren, reloadToken])

  return state
}
