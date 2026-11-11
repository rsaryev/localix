import useSWRInfinite from 'swr/infinite'
import { sessionUnderDir } from '@localixai/api/external-agent-contracts'
import { externalAgentsApi } from '../api'
import { useInstalledAgents } from './useInstalledAgents'
import { useHistoryStream } from './useHistoryStream'
import { useVisiblePolling } from '@localixai/mini-app-sdk/ui/visibility'

const PAGE_SIZE = 200

export function useExternalHistory(
  text: string,
  enabled = true,
  /** A folder's history is the sessions recorded in it and beneath it, as the server selects. */
  scope?: { provider?: string; cwd?: string },
) {
  const installed = useInstalledAgents()
  // Not keyed on the installed list: the route already narrows to installed agents, so the roster
  // starts beside `/providers` instead of waiting for it.
  const query = useSWRInfinite(
    (index, previous: Awaited<ReturnType<typeof externalAgentsApi.roster>> | null) => {
      if (!enabled || previous?.withheld === 0) return null
      return [
        'external-agents:history',
        scope?.provider ?? '',
        text,
        scope?.cwd ?? '',
        index,
      ] as const
    },
    ([, provider, search, cwd, index]) =>
      externalAgentsApi.roster({
        providers: provider ? [provider] : undefined,
        text: search,
        cwdPrefix: cwd || undefined,
        // Conversations only: sub-agent transcripts outnumber them several to one, and a page that
        // held them showed a handful of rows behind a "Show more" (their parents link to them).
        offset: index * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    {
      isPaused: () => !enabled,
      // A new search keeps the current rows until its own arrive, rather than blanking the list
      // behind a loading line on every keystroke.
      keepPreviousData: true,
      revalidateOnFocus: enabled,
      revalidateOnReconnect: enabled,
      shouldRetryOnError: false,
    },
  )
  const live = useHistoryStream(enabled, () => {
    void query.mutate()
  })
  useVisiblePolling({
    enabled: enabled && !live,
    intervalMs: 30_000,
    onTick: () => query.mutate(),
  })
  // The server filters (installed agents, provider, folder, text) and orders; pages are joined
  // once each, as a background refresh can move a row from one page to the next. The scope is
  // checked again only because `keepPreviousData` holds another folder's rows while this one's load.
  const byKey = new Map(query.data?.flatMap((page) => page.items).map((row) => [row.key, row]))
  const sessions = [...byKey.values()].filter(
    (row) =>
      !row.sourcePath.startsWith('terminal:') &&
      (!scope?.provider || row.provider === scope.provider) &&
      (!scope?.cwd || sessionUnderDir(row, scope.cwd)),
  )
  const last = query.data?.at(-1)
  return {
    agents: installed.agents,
    sessions,
    // Rows kept from the previous search still count; another scope's rows are filtered out above,
    // and an empty list while a read is running is loading, not "no sessions".
    loading: (installed.isLoading || query.isLoading) && sessions.length === 0,
    // Only a page beyond the loaded ones: a background refresh must not read as "Loading…".
    loadingMore: query.size > (query.data?.length ?? 0),
    error: installed.error ?? query.error,
    total: query.data?.[0]?.total ?? 0,
    hasMore: Boolean(last?.withheld),
    loadMore: () => query.setSize(query.size + 1),
    refresh: async () => {
      await installed.mutate()
      await query.mutate()
    },
  }
}
