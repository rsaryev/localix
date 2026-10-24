import { useRef } from 'react'
import useSWR from 'swr'
import { backendClient } from '@/shared/api/client'
import type { PluginUpdateJob, PluginUpdatesResponse } from '@/shared/api/contracts'
import { useRevalidateOnResources } from '@/shared/api/resourceGeneration'

const KEY = 'plugin-updates'

/**
 * The updates the marketplaces offer for installed plugins, and the ones in flight. Opening the
 * page fetches the listings once (`?refresh=1`), so a marketplace with auto-update off still shows
 * what it offers; after that the page reads the last check. The server pokes `plugin-updates` as an
 * update moves and announces a finished one through the plugin change notices (`capabilities`);
 * both read the status again — nothing here patches it.
 */
export function usePluginUpdates(): {
  updates: PluginUpdatesResponse | undefined
  jobFor: (id: string) => PluginUpdateJob | undefined
  updateNow: (id: string) => Promise<void>
  revalidate: () => Promise<unknown>
} {
  useRevalidateOnResources(KEY, ['plugin-updates', 'capabilities'])
  const refreshed = useRef(false)
  const { data, mutate } = useSWR(KEY, () => {
    const refresh = !refreshed.current
    refreshed.current = true
    return backendClient.getPluginUpdates({ refresh })
  })
  return {
    updates: data,
    jobFor: (id) => data?.jobs.find((job) => job.id === id),
    async updateNow(id) {
      await backendClient.applyPluginUpdates([id])
      await mutate()
    },
    revalidate: () => mutate(),
  }
}
