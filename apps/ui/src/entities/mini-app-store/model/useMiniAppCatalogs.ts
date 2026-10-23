import useSWR from 'swr'
import { backendClient } from '@/shared/api/client'
import { useRevalidateOnResources } from '@/shared/api/resourceGeneration'

const CATALOGS_KEY = 'mini-app-catalogs'

/**
 * The catalogs the store reads. A write is announced as a `mini-app-catalogs` poke, which reads
 * the list again — the write answers nothing to patch in.
 */
export function useMiniAppCatalogs() {
  useRevalidateOnResources(CATALOGS_KEY, ['mini-app-catalogs'])
  const { data, mutate } = useSWR(CATALOGS_KEY, () => backendClient.listMiniAppCatalogs())
  return {
    catalogs: data ?? [],
    add: async (url: string) => {
      await backendClient.addMiniAppCatalog(url)
      await mutate()
    },
    remove: async (url: string) => {
      await backendClient.removeMiniAppCatalog(url)
      await mutate()
    },
  }
}
