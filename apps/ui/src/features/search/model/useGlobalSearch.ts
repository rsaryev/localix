import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchGroup } from '@localixai/api/client'
import { searchApi, SearchApiError } from '../api/searchApi'
import { ALL_SCOPE, parseScope, scopeById, scopeToDomains, type ScopeDef } from './scopes'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { SearchRequestCoordinator, type SearchRequestTicket } from './searchRequestCoordinator'
import type { Problem } from '@localixai/plugin-sdk/ui/problems'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'

/**
 * The shared search hook behind BOTH surfaces (the workspace tab + the ⌘⇧F palette).
 * Owns: the raw query with typed-prefix promotion (`db:foo` → a db pill),
 * a debounced last-write-wins fetch, anti-flicker (previous results stay until the
 * next page resolves), and cursor pagination for the scoped single-domain view
 * ("Show all →" infinite scroll). Client-only domains (settings/commands) are merged
 * by the surface — this hook is the server half.
 */

const DEFAULT_GROUP_LIMIT = 6
const SCOPED_PAGE = 30
const DEFAULT_DEBOUNCE = 90
/** One frozen empty array, so a healthy search never re-renders a memo on identity alone. */
const EMPTY_PROBLEMS: Problem[] = []

export interface UseGlobalSearchOptions {
  /** Seed query (e.g. the tab's payload). */
  initialQuery?: string
  /** Seed one registered search scope without exposing any of its result data. */
  initialScope?: string
  /** Hits per group in the aggregate view (palette passes 5). */
  groupLimit?: number
  /** Active session — scopes the file provider's cwd. */
  sessionId?: string | null
  /** Active project — optional scoping. */
  projectId?: string | null
  /** Debounce for the server fetch (ms). */
  debounceMs?: number
}

export interface GlobalSearchState {
  /** The effective text (typed prefix already promoted into `scope`). */
  query: string
  /** Set the raw input; a recognized `prefix:` promotes into the active scope. */
  setQuery: (raw: string) => void
  /** The active scope (ALL_SCOPE when unfiltered). */
  scope: ScopeDef
  /** Force a scope (pill / dropdown / a group's "Show all →"). */
  setScope: (id: string | null) => void
  /** Back to "search everything". */
  clearScope: () => void
  loading: boolean
  groups: SearchGroup[]
  total: number
  /**
   * The standing failure, classified: `message` is the sentence a surface shows, `detail` keeps
   * what the server actually said for the Event Center. Null while the last search succeeded.
   *
   * This is the request failing — nothing came back at all, so a surface showing it shows
   * nothing else.
   */
  problem: Problem | null
  /**
   * Domains that could not answer while the REQUEST succeeded — a stopped Docker daemon, an
   * unreachable cluster. The results beside them are real and stay on screen; without this a
   * dead backend and "no matches" were the same empty list.
   */
  domainProblems: Problem[]
  /** A specific server domain is active (drives the flat, paginated view). */
  scopedMode: boolean
  canLoadMore: boolean
  loadMore: () => void
}

export function useGlobalSearch(opts: UseGlobalSearchOptions = {}): GlobalSearchState {
  const workItemVisible = useWorkItemVisible()
  const groupLimit = opts.groupLimit ?? DEFAULT_GROUP_LIMIT
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE
  const sessionId = opts.sessionId ?? null
  const projectId = opts.projectId ?? null

  const [queryText, setQueryText] = useState(opts.initialQuery ?? '')
  const [scopeId, setScopeId] = useState<string | null>(scopeById(opts.initialScope)?.id ?? null)
  const [groups, setGroups] = useState<SearchGroup[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [domainProblems, setDomainProblems] = useState<Problem[]>(EMPTY_PROBLEMS)
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  // How the last answer was found: words, or words and meaning (semantic search on).
  const [debounced, setDebounced] = useState(opts.initialQuery ?? '')

  // Last-write-wins guard shared by the paged fetch AND load-more.
  const coordinatorRef = useRef<SearchRequestCoordinator | null>(null)
  if (!coordinatorRef.current) coordinatorRef.current = new SearchRequestCoordinator()
  const coordinator = coordinatorRef.current

  const invalidateRequests = useCallback(() => {
    coordinator.invalidate()
  }, [coordinator])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(queryText), debounceMs)
    return () => clearTimeout(t)
  }, [queryText, debounceMs])

  const scope = scopeById(scopeId) ?? ALL_SCOPE
  const clientOnly = !!scope.clientOnly
  const scopedMode = scope.id !== ALL_SCOPE.id && !clientOnly

  const setQuery = useCallback(
    (raw: string) => {
      invalidateRequests()
      const parsed = parseScope(raw)
      if (parsed.scope) {
        setScopeId(parsed.scope.id)
        setQueryText(parsed.text)
      } else {
        setQueryText(raw)
      }
    },
    [invalidateRequests],
  )

  const setScope = useCallback(
    (id: string | null) => {
      invalidateRequests()
      setScopeId(id)
    },
    [invalidateRequests],
  )
  const clearScope = useCallback(() => {
    invalidateRequests()
    setScopeId(null)
  }, [invalidateRequests])

  useEffect(() => {
    if (!workItemVisible) {
      coordinator.invalidate()
      return
    }
    const text = debounced.trim()
    if (!text || clientOnly) {
      // Empty query, or a client-only scope (settings/commands live in the UI merge).
      // Clearing state here is intentional (mirrors QuickOpen's empty-query reset).
      /* eslint-disable react-hooks/set-state-in-effect */
      coordinator.invalidate()
      setGroups([])
      setTotal(0)
      setNextCursor(undefined)
      setLoading(false)
      setProblem(null)
      setDomainProblems(EMPTY_PROBLEMS)
      /* eslint-enable react-hooks/set-state-in-effect */
      return
    }
    const ticket = coordinator.beginPrimary()
    setLoading(true)
    searchApi
      .search(
        {
          text,
          domains: scopeToDomains(scopeId),
          limit: scopedMode ? SCOPED_PAGE : groupLimit,
          sessionId,
          projectId,
        },
        ticket.controller.signal,
      )
      .then((res) => {
        if (!coordinator.isCurrent(ticket)) return
        setGroups(res.groups)
        setTotal(res.total)
        setNextCursor(res.nextCursor)
        setProblem(null)
        setDomainProblems(res.problems ?? EMPTY_PROBLEMS)
        setLoading(false)
        coordinator.finish(ticket)
      })
      .catch((e) => {
        if (!coordinator.isCurrent(ticket)) return
        setProblem(
          e instanceof SearchApiError
            ? { message: e.message, field: e.code, detail: e.detail }
            : { message: 'The search could not run', detail: errorMessage(e, '') || undefined },
        )
        // Whatever a previous response said about individual domains is no longer known.
        setDomainProblems(EMPTY_PROBLEMS)
        setLoading(false)
        coordinator.finish(ticket)
      })
    return () => {
      ticket.controller.abort()
      coordinator.finish(ticket)
    }
  }, [
    workItemVisible,
    debounced,
    scopeId,
    scopedMode,
    clientOnly,
    groupLimit,
    sessionId,
    projectId,
    coordinator,
  ])

  const loadMore = useCallback(() => {
    if (!workItemVisible || !scopedMode || !nextCursor) return
    const text = debounced.trim()
    if (!text) return
    const ticket: SearchRequestTicket | null = coordinator.beginMore()
    if (!ticket) return
    searchApi
      .search(
        {
          text,
          domains: scopeToDomains(scopeId),
          limit: SCOPED_PAGE,
          cursor: nextCursor,
          sessionId,
          projectId,
        },
        ticket.controller.signal,
      )
      .then((res) => {
        if (!coordinator.isCurrent(ticket)) return
        setGroups((prev) => {
          const head = prev[0]
          const more = res.groups[0]?.hits ?? []
          if (!head) return res.groups
          return [{ ...head, hits: [...head.hits, ...more] }]
        })
        setNextCursor(res.nextCursor)
      })
      .catch((e: unknown) => {
        // A failed page is a one-off event, not a standing condition: what is already on screen
        // stays correct, and the person can scroll again. Silence made the list simply stop.
        if (!coordinator.isCurrent(ticket)) return
        // The headline names what did not happen; the classified reason and the server's own
        // words go underneath, where a "That search was rejected" no longer hides which action.
        toast.error('Could not load more search results', {
          description:
            e instanceof SearchApiError
              ? [e.message, e.detail].filter(Boolean).join('\n')
              : errorMessage(e, '') || undefined,
        })
      })
      .finally(() => {
        coordinator.finish(ticket)
      })
  }, [
    workItemVisible,
    scopedMode,
    nextCursor,
    debounced,
    scopeId,
    sessionId,
    projectId,
    coordinator,
  ])

  return {
    query: queryText,
    setQuery,
    scope,
    setScope,
    clearScope,
    loading,
    groups,
    total,
    problem,
    domainProblems,
    scopedMode,
    canLoadMore: scopedMode && !!nextCursor,
    loadMore,
  }
}
