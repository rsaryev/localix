import useSWR from 'swr'
import { useWorkItemVisible, useVisiblePolling } from '@localixai/plugin-sdk/ui/visibility'
import { externalAgentsApi } from '../api'
import { useInstalledAgents } from './useInstalledAgents'
import { useHistoryStream } from './useHistoryStream'

export interface ExternalStatsFilters {
  provider: string
  project: string
  model: string
}
export type ExternalStatsRange = '7' | '30' | '90' | '365'

export function useExternalStats(range: ExternalStatsRange, filters: ExternalStatsFilters) {
  const visible = useWorkItemVisible()
  const installed = useInstalledAgents()
  const ids = installed.agents.map((agent) => agent.id).join(',')
  const stats = useSWR(
    visible && ids
      ? ['external-agents:stats', ids, range, filters.provider, filters.project, filters.model]
      : null,
    () =>
      externalAgentsApi.stats({
        days: Number(range),
        providers: filters.provider ? [filters.provider] : ids.split(','),
        cwdPrefix: filters.project || undefined,
        model: filters.model || undefined,
      }),
    { revalidateOnFocus: true, shouldRetryOnError: false, keepPreviousData: true },
  )
  const refresh = async () => {
    await installed.mutate()
    await stats.mutate()
  }
  // History moving changes the numbers, not which agents are installed.
  const live = useHistoryStream(visible && Boolean(ids), () => {
    void stats.mutate()
  })
  useVisiblePolling({
    enabled: visible && Boolean(ids) && !live,
    intervalMs: 30_000,
    onTick: () => stats.mutate(),
  })
  return {
    agents: installed.agents,
    stats: stats.data,
    loading: installed.isLoading || (stats.isLoading && !stats.data),
    error: installed.error ?? stats.error,
    refresh,
  }
}
