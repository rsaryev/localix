import useSWR from 'swr'
import { backendClient } from '@/shared/api/client'
import { useRevalidateOnResources } from '@/shared/api/resourceGeneration'

const STORE_KEY = 'mini-app-store'

/**
 * What the catalogs offer, what is installed and the installs in flight. The server pokes
 * `mini-app-installs` as an install moves and `mini-apps` when one lands; either reads the list
 * again — nothing here patches it.
 */
export function useMiniAppStore(enabled = true) {
  useRevalidateOnResources(STORE_KEY, ['mini-app-installs', 'mini-apps'])
  const { data, error, isLoading, mutate } = useSWR(enabled ? STORE_KEY : null, () =>
    backendClient.listMiniAppStore(),
  )
  const install = async (name: string) => {
    await backendClient.installMiniApp(name)
    await mutate()
  }
  return { entries: data ?? [], error, loading: isLoading, install }
}
