import useSWRInfinite from 'swr/infinite'
import { isAtOrUnder } from '@localixai/path-containment/ancestry'
import { externalAgentsApi } from '../api'
import { useInstalledAgents } from './useInstalledAgents'
import { useHistoryStream } from './useHistoryStream'
import { useVisiblePolling } from '@localixai/mini-app-sdk/ui/visibility'

const PAGE_SIZE = 200

export function useExternalHistory(
  text: string,
  enabled = true,
  scope?: { provider?: string; cwd?: string; includeDescendants?: boolean },
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
        includeChildren: true,
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
  const byKey = new Map(query.data?.flatMap((page) => page.items).map((row) => [row.key, row]))
  const sessions = [...byKey.values()]
    .filter(
      (row) =>
        !row.sourcePath.startsWith('terminal:') &&
        installed.agents.some((agent) => agent.id === row.provider) &&
        (!scope?.provider || row.provider === scope.provider) &&
        (!scope?.cwd ||
          row.cwd === scope.cwd ||
          (scope.includeDescendants &&
            row.cwd &&
            isAtOrUnder(scope.cwd.replace(/\/+$/, '') || '/', row.cwd))),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const last = query.data?.at(-1)
  return {
    agents: installed.agents,
    sessions,
    // Rows kept from the previous search still count; rows of another scope are filtered out above,
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
