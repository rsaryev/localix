import useSWR from 'swr'
import { backendClient } from '@/shared/api/client'
import { useRevalidateOnResources } from '@/shared/api/resourceGeneration'

const STORE_KEY = 'mini-app-store'

/**
 * What the catalogs offer, what is installed and the installs in flight. The server pokes
 * `mini-app-installs` as an install moves, `mini-apps` when one lands and `mini-app-catalogs` when a
 * catalog is added or removed; each reads the list
 * again — nothing here patches it.
 */
export function useMiniAppStore(enabled = true) {
  useRevalidateOnResources(STORE_KEY, ['mini-app-installs', 'mini-apps', 'mini-app-catalogs'])
  const { data, error, isLoading, mutate } = useSWR(enabled ? STORE_KEY : null, () =>
    backendClient.listMiniAppStore(),
  )
  const install = async (name: string, opts?: { acceptUnverified?: boolean }) => {
    await backendClient.installMiniApp(name, opts)
    await mutate()
  }
  const remove = async (name: string) => {
    await backendClient.removeMiniApp(name)
    await mutate()
  }
  return {
    entries: data?.entries ?? [],
    problems: data?.problems ?? [],
    error,
    loading: isLoading,
    install,
    remove,
  }
}
