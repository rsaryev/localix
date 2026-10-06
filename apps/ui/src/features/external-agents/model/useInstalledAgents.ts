import useSWR from 'swr'
import { externalAgentsApi } from '../api'

const NO_AGENTS: Awaited<ReturnType<typeof externalAgentsApi.providers>> = []

/** One shared response feeds history and launch controls, including after installation changes. */
export function useInstalledAgents() {
  const query = useSWR('external-agents:installed', () => externalAgentsApi.providers(), {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 5_000,
    refreshInterval: 30_000,
    shouldRetryOnError: false,
  })
  return { ...query, agents: query.data ?? NO_AGENTS }
}
