import { semanticApi } from '@/shared/api/semanticApi'
import { useEffect, useMemo } from 'react'
import { CornerDownLeft } from 'lucide-react'
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@localixai/kit/command'
import { CommandHints } from '@/shared/ui/command-hints'
import { inspector } from '@/shared/lib/inspectorBus'
import { useChatStore } from '@/features/chat/model/store'
import { useGlobalSearch } from '../model/useGlobalSearch'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { activateSearchHit } from '../model/activateSearch'
import {
  buildClientGroups,
  mergeClientGroups,
  type SearchCommandEntry,
} from '../model/searchClient'
import { SearchHitContent } from './SearchResults'
import type { SearchHit } from '@localixai/api/client'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { ProblemLine } from '@/shared/ui/problem-report'

interface GlobalSearchPaletteProps {
  /** The chat the palette searches and opens hits in — the page passes the open chat. `null`
   *  when none is open: file hits then have no workspace, and "Open in Search" opens nothing. */
  sessionId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The palette command registry (structurally a `PaletteCommand[]`) → the Commands scope. */
  commands: SearchCommandEntry[]
}

/**
 * ⌘⇧F global-search palette — the fast entry point over the
 * SAME endpoint as the workspace tab. Fans a query across every domain (server-side,
 * `shouldFilter` off) plus the client-only Settings + Commands scopes, showing the top
 * few per group. Enter opens the pick; a pinned "Open in Search" row escalates the
 * query to the full workspace tab (infinite scroll, all filters). Reuses the shared cmdk
 * shell + the shared activation seam, so a hit behaves the same here as in the tab.
 */
export function GlobalSearchPalette({
  sessionId,
  open,
  onOpenChange,
  commands,
}: GlobalSearchPaletteProps) {
  const activeProjectId = useChatStore((s) => s.activeProjectId)
  const search = useGlobalSearch({
    groupLimit: 5,
    sessionId,
    projectId: activeProjectId,
  })
  const { setQuery, clearScope } = search

  const activate = useUiNavigation({
    sessionId,
    sessionProjectId: (id) =>
      useChatStore.getState().allSessions.find((session) => session.id === id)?.projectId ?? null,
  })

  const trimmed = search.query.trim()
  // Same composition as the tab: the request failing, then whichever domains could not answer.
  const problems = search.problem
    ? [search.problem, ...search.domainProblems]
    : search.domainProblems
  const clientGroups = useMemo(
    () => buildClientGroups({ query: trimmed, commands, limit: 5 }),
    [trimmed, commands],
  )
  const displayGroups = useMemo(
    () => mergeClientGroups(search.scope, search.groups, clientGroups),
    [search.scope, search.groups, clientGroups],
  )

  // Reset to "search everything" each time the palette opens so a stale query/scope
  // never flashes (mirrors QuickOpen).
  useEffect(() => {
    if (open) {
      setQuery('')
      clearScope()
      // Start the embedding engine while the person types, so the first query does not wait.
      void semanticApi.prewarm().catch(() => {})
    }
  }, [open, setQuery, clearScope])

  // Close first, then act next tick — a command's run() may open another dialog, and
  // two overlapping dialogs fight for focus (the shared CommandPalette does the same).
  const pick = (hit: SearchHit) => {
    onOpenChange(false)
    setTimeout(() => activateSearchHit(hit, activate), 0)
  }
  const openInSearch = () => {
    onOpenChange(false)
    if (sessionId) inspector.openGlobalSearch(sessionId, search.query)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Global search"
      description="Search across the whole workspace"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder={search.scope.placeholder ?? 'Search everything…'}
          value={search.query}
          onValueChange={search.setQuery}
        />
        <CommandList>
          {problems.length > 0 && (
            // Rendered, not published: the Search tab owns this subject's Event Center row, and an
            // overlay that closes on Escape must not settle a problem still standing behind it.
            <div className="px-3 py-3">
              <ProblemLine
                report={{
                  subject: { label: 'Search' },
                  consequence: search.problem ? 'blocked' : 'none',
                  problems,
                }}
              />
            </div>
          )}
          {search.problem ? null : trimmed.length === 0 ? (
            <CommandEmpty>Search projects, chats, messages, settings, commands…</CommandEmpty>
          ) : displayGroups.length === 0 ? (
            <CommandEmpty>
              {search.loading ? (
                <ActivitySignal label="Searching" className="justify-center" />
              ) : (
                `No results for “${trimmed}”.`
              )}
            </CommandEmpty>
          ) : null}

          {displayGroups.map((group) => (
            <CommandGroup
              key={group.domain}
              heading={
                group.total > group.hits.length ? `${group.title} · ${group.total}` : group.title
              }
            >
              {group.hits.map((hit, i) => (
                <CommandItem
                  key={`${group.domain}-${hit.id}`}
                  value={`${group.domain} ${hit.title} ${hit.id} ${i}`}
                  onSelect={() => pick(hit)}
                  className="group gap-2"
                >
                  <SearchHitContent hit={hit} query={trimmed} />
                </CommandItem>
              ))}
            </CommandGroup>
          ))}

          {trimmed.length > 0 && sessionId && (
            <>
              <CommandSeparator />
              <CommandItem value="__open_in_search__" onSelect={openInSearch} className="gap-2">
                <CornerDownLeft className="size-4 shrink-0 text-text-faint" />
                <span className="text-text-soft">Open in Search — see all results</span>
              </CommandItem>
            </>
          )}
        </CommandList>
        <CommandHints active="commands" />
      </Command>
    </CommandDialog>
  )
}
