/**
 * Roster fetching: debounced text, server-side filtering, sequence-guarded responses, and
 * offset paging that appends.
 *
 * Filtering happens on the SERVER (the query carries `providers` / `states`), never by filtering an
 * already-fetched array: the design point is thousands of rows across six providers, and a
 * client-side filter would require fetching all of them first, which is the exact thing the bounded
 * `withheld` contract exists to avoid.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalAgentsApiError, externalAgentsApi } from '../api/externalAgentsApi'
import { appendPage, sortRoster } from './rosterOrder'
import { MAX_ROSTER_LIMIT } from './types'
import type { RosterQuery, RosterRow } from './types'

/** The sentence and the raw text, kept apart: one goes on the line, the other to the centre. */
function failure(cause: unknown): { error: string; errorDetail: string | null } {
  return cause instanceof ExternalAgentsApiError
    ? { error: cause.message, errorDetail: cause.detail ?? null }
    : { error: 'Could not read the agent roster.', errorDetail: String(cause) }
}

/** One page. Small enough to paint fast, large enough that a scroll rarely waits. */
export const ROSTER_PAGE_SIZE = 200

/** Text filter debounce. Short enough to feel live, long enough to skip intra-word requests. */
export const TEXT_DEBOUNCE_MS = 150

export interface RosterFilters {
  text: string
  providers: string[]
  states: string[]
  /** A project drill: `RosterQuery.cwdPrefix`, which nothing sent until the project axis drilled. */
  cwdPrefix?: string
  /** Sub-agent transcripts, hidden by default: 1,540 of a real history's 1,822 rows. */
  includeChildren?: boolean
  /** An exact model name: matches a row's own model or any model inside its usage. */
  model?: string
  /** A parent session's key: selects the sub-agents it spawned, children-hidden default included. */
  parentKey?: string
}

export interface RosterState {
  rows: RosterRow[]
  /** Rows matching the filter that the backend did not return. `0` means the list is complete. */
  withheld: number
  total: number
  loading: boolean
  loadingMore: boolean
  error: string | null
  /** The raw text behind `error` — a foreign provider's own words. Event Center only. */
  errorDetail: string | null
  reachedEnd: boolean
}

const EMPTY: RosterState = {
  rows: [],
  withheld: 0,
  total: 0,
  loading: true,
  loadingMore: false,
  error: null,
  errorDetail: null,
  reachedEnd: false,
}

/**
 * Exported for its own test: a mutation sweep showed every filter here could be dropped with the whole
 * suite still green, because nothing but the hook — which needs React to run — ever built a query.
 */
export function toQuery(
  filters: RosterFilters,
  offset: number,
  limit = ROSTER_PAGE_SIZE,
): RosterQuery {
  return {
    ...(filters.text.trim() ? { text: filters.text.trim() } : {}),
    ...(filters.providers.length > 0 ? { providers: filters.providers } : {}),
    ...(filters.states.length > 0 ? { states: filters.states as RosterQuery['states'] } : {}),
    ...(filters.cwdPrefix ? { cwdPrefix: filters.cwdPrefix } : {}),
    ...(filters.includeChildren ? { includeChildren: true } : {}),
    ...(filters.model ? { model: filters.model } : {}),
    ...(filters.parentKey ? { parentKey: filters.parentKey } : {}),
    offset,
    limit,
  }
}

/**
 * The identity of a filter SET — what a fetch was made for.
 *
 * Built over every field of `RosterFilters` on purpose. It used to cover three of them, and the
 * effect that fetches the first page rebuilt its query from those same three: `cwdPrefix`,
 * `includeChildren` and `model` were dropped on the way out AND absent from the dependency array,
 * so the sub-agent toggle and both statistics drills narrowed nothing at all. Each had been checked
 * end to end — fold, route, and `toQuery` — and the one seam nobody looked at was the caller.
 *
 * JSON rather than a delimiter join: a filter value is arbitrary user text, and any separator cheap
 * enough to type is one a search string could contain.
 */
export function filterKeyOf(filters: RosterFilters): string {
  return JSON.stringify([
    filters.text,
    filters.providers.join(','),
    filters.states.join(','),
    filters.cwdPrefix ?? '',
    filters.includeChildren === true,
    filters.model ?? '',
    filters.parentKey ?? '',
  ])
}

export function useRoster(
  filters: RosterFilters,
  reloadToken: number,
  active: boolean,
): RosterState & { loadMore: () => void } {
  const [state, setState] = useState<RosterState>(EMPTY)

  /**
   * Monotonic request id. A slow response for an older filter MUST NOT overwrite a newer one:
   * typing "cl" then "cla" can resolve out of order, and without this guard the list would settle
   * on the stale result with no way for the user to tell.
   */
  const seqRef = useRef(0)
  /** Offset of the next page, in SERVER order — never derived from the displayed row count. */
  const offsetRef = useRef(0)

  // Filters are consumed through one key so a caller re-creating the object each render cannot
  // retrigger a fetch; only their contents matter.
  const filterKey = filterKeyOf(filters)
  /**
   * The set the effect and `loadMore` actually query with, held in a ref rather than closed over:
   * the effect depends on `filterKey`, and reading the object through the ref keeps the two from
   * disagreeing about which set a page belongs to.
   */
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  /** The filters the rows on screen were fetched for, so a re-run can tell refresh from restart. */
  const filterKeyRef = useRef(filterKey)

  useEffect(() => {
    // Warm work items stay mounted under `display: none`; a hidden roster must not scan four agent
    // history roots for a tab nobody is looking at. It refetches when it comes back on screen.
    if (!active) return
    const snapshot = filtersRef.current
    /**
     * A REFRESH is not a filter change, and conflating the two threw the user's paging away.
     *
     * This effect re-runs both when the filters move and when the poll ticks, and it used to
     * respond identically: reset to offset 0 and replace the rows with one page. So scrolling
     * through several pages and then waiting one tick — five seconds while a delegation runs —
     * collapsed the list back to 200 rows under the reader, scroll position included.
     *
     * A filter change genuinely starts over. A refresh must come back with the depth already on
     * screen, which one call can do: the server's bound is well above a page.
     */
    const isRefresh = filterKeyRef.current === filterKey
    filterKeyRef.current = filterKey
    const want = isRefresh
      ? Math.min(Math.max(offsetRef.current, ROSTER_PAGE_SIZE), MAX_ROSTER_LIMIT)
      : ROSTER_PAGE_SIZE
    const seq = (seqRef.current += 1)
    if (!isRefresh) offsetRef.current = 0
    setState((prev) => ({ ...prev, loading: true, error: null }))
    const timer = setTimeout(() => {
      void externalAgentsApi
        .roster(toQuery(snapshot, 0, want))
        .then((page) => {
          if (seq !== seqRef.current) return
          offsetRef.current = page.items.length
          setState({
            rows: sortRoster(page.items),
            withheld: page.withheld,
            total: page.total,
            loading: false,
            loadingMore: false,
            error: null,
            errorDetail: null,
            reachedEnd: page.items.length === 0 || page.items.length >= page.total,
          })
        })
        .catch((cause: unknown) => {
          if (seq !== seqRef.current) return
          setState({ ...EMPTY, loading: false, ...failure(cause) })
        })
    }, TEXT_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [active, filterKey, reloadToken])

  const loadMore = useCallback(() => {
    if (state.loading || state.loadingMore || state.reachedEnd) return
    const seq = seqRef.current
    const offset = offsetRef.current
    setState((prev) => ({ ...prev, loadingMore: true }))
    void externalAgentsApi
      .roster(toQuery(filtersRef.current, offset))
      .then((page) => {
        // Same guard as the first page: a filter change while a page was in flight invalidates it.
        if (seq !== seqRef.current) return
        offsetRef.current = offset + page.items.length
        setState((prev) => {
          const rows = appendPage(prev.rows, page.items)
          return {
            ...prev,
            rows,
            withheld: page.withheld,
            total: page.total,
            loadingMore: false,
            // An empty page ends paging even if `total` disagrees — a growing history would
            // otherwise keep the list asking forever.
            reachedEnd: page.items.length === 0 || rows.length >= page.total,
          }
        })
      })
      .catch((cause: unknown) => {
        if (seq !== seqRef.current) return
        setState((prev) => ({ ...prev, loadingMore: false, ...failure(cause) }))
      })
    // No filter belongs here: the set is read through `filtersRef` at call time, so a page always
    // belongs to whatever is on screen when the reader asks for it. Naming three of the six fields —
    // which this list used to do — bought nothing and read as if the other three did not exist.
  }, [state.loading, state.loadingMore, state.reachedEnd])

  return { ...state, loadMore }
}
