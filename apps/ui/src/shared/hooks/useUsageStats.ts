import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import type { UsageOverview, UsageLogRow, UsageKeys } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { type UsageRange, rangeToFromIso, rangeToBucket } from './usageRange'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'

export type { UsageRange }
export { rangeToFromIso }
export type UsageGroupBy = 'model' | 'provider' | 'kind' | 'agent'
export interface UsageFilters {
  model?: string
  provider?: string
  session?: string
  agent?: string
}

export interface UsageOverviewResult {
  overview?: UsageOverview
  isLoading: boolean
  error: unknown
  refetch: () => void
}

/** The dashboard's top section: summary + breakdown + trend in a single request. */
export function useUsageOverview(
  range: UsageRange,
  groupBy: UsageGroupBy,
  nowMs: number,
  filters: UsageFilters,
): UsageOverviewResult {
  const workItemVisible = useWorkItemVisible()
  const from = rangeToFromIso(range, nowMs)
  const bucket = rangeToBucket(range)
  const { model, provider, session, agent } = filters
  const { data, isLoading, error, mutate } = useSWR(
    workItemVisible
      ? ([
          'usage-overview',
          range,
          groupBy,
          from ?? 'all',
          bucket,
          model ?? '',
          provider ?? '',
          session ?? '',
          agent ?? '',
        ] as const)
      : null,
    () =>
      backendClient.getUsageOverview({ from, groupBy, bucket, model, provider, session, agent }),
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  )
  return {
    overview: data,
    isLoading,
    error,
    refetch: () => {
      if (workItemVisible) void mutate()
    },
  }
}

/** Filter dropdown options (models/providers used, sessions with usage). */
export function useUsageKeys(): { keys?: UsageKeys; isLoading: boolean } {
  const workItemVisible = useWorkItemVisible()
  const { data, isLoading } = useSWR(
    workItemVisible ? 'usage-keys' : null,
    () => backendClient.getUsageKeys(),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  )
  return { keys: data, isLoading }
}

export interface UsageLogsResult {
  rows: UsageLogRow[]
  isLoading: boolean
  isLoadingMore: boolean
  hasMore: boolean
  error: unknown
  loadMore: () => void
}

/**
 * Cursor-paginated request log. Resets when range/filters change; `loadMore`
 * appends the next page (drives infinite scroll). Manual fetch (not SWR) since
 * pages accumulate and the dataset can be very large (1M+ rows).
 */
export function useUsageLogs(
  range: UsageRange,
  nowMs: number,
  filters: UsageFilters,
): UsageLogsResult {
  const workItemVisible = useWorkItemVisible()
  const from = rangeToFromIso(range, nowMs)
  const { model, provider, session, agent } = filters

  const [rows, setRows] = useState<UsageLogRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<unknown>(null)

  // Monotonic request id so a slow earlier fetch (e.g. for a now-changed filter)
  // can't overwrite a newer one's rows/cursor — that would render stale data
  // under the current filter and paginate with a mismatched cursor.
  const reqIdRef = useRef(0)
  const invalidatePendingRequests = useCallback(() => {
    reqIdRef.current += 1
  }, [])
  const fetchPage = useCallback(
    async (reset: boolean, nextCursor: string | null) => {
      const myId = ++reqIdRef.current
      if (reset) setIsLoading(true)
      else setIsLoadingMore(true)
      setError(null)
      try {
        const page = await backendClient.getUsageLogs({
          from,
          model,
          provider,
          session,
          agent,
          cursor: nextCursor,
          limit: 50,
        })
        if (myId !== reqIdRef.current) return // superseded by a newer fetch — drop
        setRows((prev) => (reset ? page.rows : [...prev, ...page.rows]))
        setCursor(page.nextCursor)
        setHasMore(page.nextCursor !== null)
      } catch (e) {
        if (myId === reqIdRef.current) setError(e)
      } finally {
        // Only the latest request owns the loading flags.
        if (myId === reqIdRef.current) {
          if (reset) setIsLoading(false)
          else setIsLoadingMore(false)
        }
      }
    },
    [from, model, provider, session, agent],
  )

  // Reset + load first page whenever the range/filters change. Defer past a
  // microtask so the synchronous setIsLoading(true) inside fetchPage doesn't run
  // in the effect body itself (avoids cascading-render lint; same observable
  // behavior — the loading flag still flips before the network response).
  useEffect(() => {
    if (!workItemVisible) {
      invalidatePendingRequests()
      return
    }
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) void fetchPage(true, null)
    })
    return () => {
      cancelled = true
      invalidatePendingRequests()
    }
  }, [workItemVisible, fetchPage, invalidatePendingRequests])

  const loadMore = useCallback(() => {
    if (workItemVisible && !isLoadingMore && hasMore && cursor) void fetchPage(false, cursor)
  }, [workItemVisible, fetchPage, isLoadingMore, hasMore, cursor])

  return { rows, isLoading, isLoadingMore, hasMore, error, loadMore }
}
