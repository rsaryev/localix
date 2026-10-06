import useSWRInfinite from 'swr/infinite'
import { externalAgentsApi } from '../api'
import { useInstalledAgents } from './useInstalledAgents'
import { useHistoryStream } from './useHistoryStream'
import { useVisiblePolling } from '@localixai/plugin-sdk/ui/visibility'

const PAGE_SIZE = 200

export function useExternalHistory(
  text: string,
  enabled = true,
  scope?: { provider?: string; cwd?: string },
) {
  const installed = useInstalledAgents()
  const providers = installed.agents
    .filter((agent) => !scope?.provider || agent.id === scope.provider)
    .map((agent) => agent.id)
    .join(',')
  const query = useSWRInfinite(
    (index, previous: Awaited<ReturnType<typeof externalAgentsApi.roster>> | null) => {
      if (!providers || previous?.withheld === 0) return null
      return ['external-agents:history', providers, text, scope?.cwd ?? '', index] as const
    },
    ([, ids, search, cwd, index]) =>
      externalAgentsApi.roster({
        providers: ids.split(','),
        text: search,
        cwdPrefix: cwd || undefined,
        includeChildren: true,
        offset: index * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    {
      isPaused: () => !enabled,
      revalidateOnFocus: enabled,
      revalidateOnReconnect: enabled,
      shouldRetryOnError: false,
    },
  )
  const live = useHistoryStream(enabled && Boolean(providers), () => {
    void query.mutate()
  })
  useVisiblePolling({
    enabled: enabled && Boolean(providers) && !live,
    intervalMs: 30_000,
    onTick: () => query.mutate(),
  })
  const byKey = new Map(query.data?.flatMap((page) => page.items).map((row) => [row.key, row]))
  const sessions = [...byKey.values()]
    .filter(
      (row) =>
        !row.sourcePath.startsWith('terminal:') &&
        installed.agents.some((agent) => agent.id === row.provider) &&
        (!scope?.cwd || row.cwd === scope.cwd),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const last = query.data?.at(-1)
  return {
    agents: installed.agents,
    sessions,
    loading: installed.isLoading || query.isLoading,
    loadingMore: query.isValidating,
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
