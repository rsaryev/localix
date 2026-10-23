import useSWR from 'swr'
import { backendClient } from '@/shared/api/client'
import { useRevalidateOnResources } from '@/shared/api/resourceGeneration'
import type { StoreCatalogs } from './storeActions'

const CATALOGS_KEY = 'mini-app-catalogs'

/**
 * The catalogs the store reads. A write is announced as a `mini-app-catalogs` poke, which reads
 * the list again — the write answers nothing to patch in. A preview reads a catalog without
 * adding it.
 */
export function useMiniAppCatalogs(): StoreCatalogs {
  useRevalidateOnResources(CATALOGS_KEY, ['mini-app-catalogs'])
  const { data, mutate } = useSWR(CATALOGS_KEY, () => backendClient.listMiniAppCatalogs())
  return {
    list: data ?? [],
    preview: (url) => backendClient.previewMiniAppCatalog(url),
    add: async (url) => {
      await backendClient.addMiniAppCatalog(url)
      await mutate()
    },
    remove: async (url) => {
      await backendClient.removeMiniAppCatalog(url)
      await mutate()
    },
  }
}
