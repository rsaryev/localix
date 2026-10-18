import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { SearchInput } from '@localixai/kit/search-input'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { Search } from 'lucide-react'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'
import { useChatStore } from '@/features/chat/model/store'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'
import { useGlobalSearch } from '../model/useGlobalSearch'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { activateSearchHit } from '../model/activateSearch'
import { buildClientGroups, mergeClientGroups } from '../model/searchClient'
import { getUiCommands } from '@/shared/contrib/uiCommands'
import { subscribeUiLocations, uiLocationRevision } from '@/shared/contrib/uiLocations'
import { ALL_SCOPE } from '../model/scopes'
import { ScopeBar } from './ScopeBar'
import { GroupSection, ScopedResults } from './SearchResults'
import { ProblemLine, useProblemReport } from '@/shared/ui/problem-report'

/**
 * The global-search workspace tab — a full-screen surface opened from
 * the rail search icon (and the ⌘⇧F palette's "Open in Search"). One search box +
 * scope pills over grouped results: the aggregate view shows the top hits per domain
 * with a "Show all →" that drills into that domain's flat, infinitely-scrolling list.
 * All results come from the single `POST /rpc/search` endpoint via `useGlobalSearch`.
 */
export function GlobalSearchTab({
  initialQuery,
  initialScope,
}: {
  initialQuery: string
  initialScope?: string
}) {
  // The chat this Search tab BELONGS to (its grid scope), and that chat's project. Reading the
  // chat on screen instead made a kept-alive Search tab of chat A search B's workspace and open
  // B's hits once the person switched chats.
  const sessionId = useWorkItemSessionId()
  const projectId = useChatStore(
    (s) => s.allSessions.find((session) => session.id === sessionId)?.projectId ?? null,
  )
  const uiLocationsRevision = useSyncExternalStore(
    subscribeUiLocations,
    uiLocationRevision,
    uiLocationRevision,
  )
  const search = useGlobalSearch({ initialQuery, initialScope, sessionId, projectId })
  const activate = useUiNavigation({
    sessionId,
    sessionProjectId: (id) =>
      useChatStore.getState().allSessions.find((session) => session.id === id)?.projectId ?? null,
  })

  // The tab is one per chat — re-opening it with a new seed query changes the payload
  // without remounting, so sync the seed in (once per distinct value; user edits win
  // afterwards).
  const seededRef = useRef<string | null>(null)
  const seededScopeRef = useRef<string | null>(null)
  const { setQuery } = search
  const { setScope } = search
  useEffect(() => {
    if (initialQuery && seededRef.current !== initialQuery) {
      seededRef.current = initialQuery
      setQuery(initialQuery)
    }
  }, [initialQuery, setQuery])
  useEffect(() => {
    if (initialScope && seededScopeRef.current !== initialScope) {
      seededScopeRef.current = initialScope
      setScope(initialScope)
    }
  }, [initialScope, setScope])

  // The tab is the durable surface, so it OWNS the search report; the ⌘⇧F palette renders the same
  // line without publishing, since a transient overlay settling this row would erase a failure the
  // person can still see behind it.
  //
  // ONE report, not two: a failed request and a domain that could not answer are the same subject
  // to the person, and two owners of "Search" would settle each other's Event Center row.
  const problems = search.problem
    ? [search.problem, ...search.domainProblems]
    : search.domainProblems
  const searchProblem = useProblemReport(
    problems.length
      ? {
          subject: { label: 'Search' },
          // A failed REQUEST renders nothing — the report is the surface. A failed DOMAIN leaves
          // every other domain's results standing, so the line is a finding beside them.
          consequence: search.problem ? 'blocked' : 'none',
          problems,
        }
      : null,
    { scope: 'search' },
  )

  const q = search.query
  const trimmed = q.trim()

  // Settings is a client-only navigation domain merged alongside the server groups
  // (the ⌘⇧F palette additionally merges Commands). Show them all when Settings is
  // the focused scope.
  const clientGroups = useMemo(() => {
    void uiLocationsRevision
    return buildClientGroups({
      query: trimmed,
      commands: getUiCommands(),
      limit: search.scope.clientOnly ? 100 : 6,
    })
  }, [trimmed, search.scope.clientOnly, uiLocationsRevision])
  const displayGroups = useMemo(
    () => mergeClientGroups(search.scope, search.groups, clientGroups),
    [search.scope, search.groups, clientGroups],
  )

  // No ground coat: the hosting pane already paints one, and under the macOS glass theme the
  // ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* No fill and not sticky — the bare stacked toolbar, the standard for a filter header
          over a list. Both of this header's past treatments were
          answers to a problem it does not have: nothing ever scrolls UNDER it. The results below
          are a SIBLING with their own `overflow-auto`, so `sticky top-0` never engages and an
          occluder has nothing to occlude — every fill it was given could only differ from the pane
          it sits on, first too dark (`bg-background/95`, then `lx-occluder`'s second coat of the
          pane's own ground) and then too light. Inheriting the pane's ground and separating with
          the toolbar's own `border-b` is the only treatment that cannot drift from its neighbour.
          `lx-occluder` stays for the strips that genuinely have content sliding beneath them —
          table heads, hunk bars, list-section heads. */}
      <WorkbenchToolbar as="header" aria-label="Global search controls" layout="stacked">
        <SearchInput
          value={q}
          onValueChange={search.setQuery}
          autoFocus
          // `rounded-full`, matching the scope pills directly beneath it. By tokens the field
          // already shares their fill and border, but a wide `rounded-lg` slab over a row of
          // pills reads as a different family — the corner is what makes the row one control
          // group rather than a box with chips under it.
          className="rounded-full"
          placeholder={search.scope.placeholder ?? 'Search everything…'}
          onKeyDown={(e) => {
            // Backspace on an empty box drops the active scope pill.
            if (e.key === 'Backspace' && q.length === 0 && search.scope.id !== ALL_SCOPE.id) {
              search.clearScope()
            }
          }}
        />
        <ScopeBar scope={search.scope} onPick={search.setScope} />
      </WorkbenchToolbar>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin px-2 py-2">
        {searchProblem && (
          <div className="px-2 py-3">
            <ProblemLine {...searchProblem} />
          </div>
        )}
        {search.problem ? null : trimmed.length === 0 ? (
          <StateNotice icon={Search} title="Search everything" />
        ) : displayGroups.length === 0 ? (
          search.loading ? (
            <LoadingHint />
          ) : (
            <EmptyHint className="h-auto items-start justify-start px-3 py-4">{`No results for “${trimmed}”.`}</EmptyHint>
          )
        ) : search.scopedMode && search.groups[0] ? (
          <ScopedResults
            group={search.groups[0]}
            query={trimmed}
            onActivate={(hit) => activateSearchHit(hit, activate)}
            canLoadMore={search.canLoadMore}
            onLoadMore={search.loadMore}
          />
        ) : (
          <div className="flex flex-col gap-3 pb-4">
            {displayGroups.map((group) => (
              <GroupSection
                key={group.domain}
                group={group}
                query={trimmed}
                onActivate={(hit) => activateSearchHit(hit, activate)}
                onShowAll={() => search.setScope(group.domain)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
