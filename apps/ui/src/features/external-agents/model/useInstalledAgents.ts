import useSWR from 'swr'
import { externalAgentsApi } from '../api'

const NO_AGENTS: Awaited<ReturnType<typeof externalAgentsApi.providers>> = []

/** One shared response feeds history and launch controls, including after installation changes. */
export function useInstalledAgents() {
  const query = useSWR('external-agents:installed', () => externalAgentsApi.providers(), {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    // Focus is when a newly installed CLI can matter; a 30 s poll in every window cost ~1,000
    // requests a day for a list that changes when the user installs something.
    dedupingInterval: 5_000,
    shouldRetryOnError: false,
  })
  return { ...query, agents: query.data ?? NO_AGENTS }
}
