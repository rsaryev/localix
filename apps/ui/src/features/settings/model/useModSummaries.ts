import useSWR from 'swr'
import { useRevalidateOnResources } from '@/shared/api/resourceGeneration'
import { modsApi, type ModSummary } from '@/shared/api/modsApi'

const KEY = 'mods-overview'

/** Each plugin's mod — what it hooks, or why it did not load — by plugin name; re-read on `mods`. */
export function useModSummaries(): ReadonlyMap<string, ModSummary> {
  useRevalidateOnResources(KEY, ['mods'])
  const { data } = useSWR(KEY, () => modsApi.overview())
  return new Map((data?.mods ?? []).map((mod) => [mod.plugin, mod]))
}
