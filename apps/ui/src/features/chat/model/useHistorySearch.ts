import { useEffect, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import type { HistorySearchHit } from '@/shared/api/contracts'

const EMPTY_HITS: HistorySearchHit[] = []

/**
 * Debounced cross-conversation message search (FTS5, server-side). Backs the
 * sidebar's "Found in messages" section — distinct from the client-side title
 * filter. Queries shorter than 2 chars are ignored (FTS5 noise + cost).
 *
 * State is a single settled `{ query, hits }` result; everything the consumer
 * sees is DERIVED from it — a short query reads as "empty, idle", an active
 * query whose result hasn't settled yet reads as "loading" (keeping the last
 * hits visible while typing, exactly like the previous behavior). The effect
 * only setStates asynchronously (post-debounce), never synchronously.
 */
export function useHistorySearch(query: string): { hits: HistorySearchHit[]; loading: boolean } {
  const [result, setResult] = useState<{ query: string; hits: HistorySearchHit[] } | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return // short queries render as empty via the derived return below
    let alive = true
    const timer = setTimeout(() => {
      backendClient
        .searchHistory(q, 30)
        .then((hits) => {
          if (alive) setResult({ query: q, hits })
        })
        .catch(() => {
          if (alive) setResult({ query: q, hits: [] })
        })
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query])

  const q = query.trim()
  const active = q.length >= 2
  // Show settled hits only while the current query REFINES the settled one
  // (classic keep-last-hits-while-typing). An unrelated query must not flash
  // another search's results for the debounce+fetch window.
  const relevant = result !== null && q.startsWith(result.query)
  return {
    hits: active && relevant ? result.hits : EMPTY_HITS,
    loading: active && result?.query !== q,
  }
}
