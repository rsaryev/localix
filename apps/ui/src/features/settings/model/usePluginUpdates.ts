import useSWR from 'swr'
import { backendClient } from '@/shared/api/client'
import type { PluginUpdateJob, PluginUpdatesResponse } from '@/shared/api/contracts'
import { useRevalidateOnResources } from '@/shared/api/resourceGeneration'

const KEY = 'plugin-updates'

/**
 * The updates the marketplaces offer for installed plugins, and the ones in flight. The server
 * pokes `plugin-updates` as an update moves and announces a finished one through the plugin
 * change notices (`capabilities`); both read the status again — nothing here patches it.
 */
export function usePluginUpdates(): {
  updates: PluginUpdatesResponse | undefined
  jobFor: (id: string) => PluginUpdateJob | undefined
  updateNow: (id: string) => Promise<void>
} {
  useRevalidateOnResources(KEY, ['plugin-updates', 'capabilities'])
  const { data, mutate } = useSWR(KEY, () => backendClient.getPluginUpdates())
  return {
    updates: data,
    jobFor: (id) => data?.jobs.find((job) => job.id === id),
    async updateNow(id) {
      await backendClient.applyPluginUpdates([id])
      await mutate()
    },
  }
}
