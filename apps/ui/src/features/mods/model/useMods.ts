import useSWR from 'swr'
import { useRevalidateOnResources } from '@/shared/api/resourceGeneration'
import { modsApi } from '@/shared/api/modsApi'

const OVERVIEW_KEY = 'mods-overview'

/** The loaded mods, their open panes and the mods that failed to load; re-read on `mods`. */
export function useModsOverview() {
  useRevalidateOnResources(OVERVIEW_KEY, ['mods'])
  return useSWR(OVERVIEW_KEY, () => modsApi.overview())
}

/**
 * One pane's drawing at a width, drawn again whenever the mod pokes `mods`. `onDrawn` hears each
 * drawing, an unchanged one too: a `Client` takes its props again from every one.
 */
export function useModPane(
  pane: { instance: string; id: string } | null,
  columns: number,
  onDrawn?: () => void,
) {
  const key = pane ? `mod-pane:${pane.instance}:${pane.id}:${columns}` : null
  useRevalidateOnResources(key ?? 'mod-pane:none', ['mods'])
  return useSWR(
    key,
    () => modsApi.pane(pane!.instance, pane!.id, columns),
    onDrawn ? { onSuccess: onDrawn } : {},
  )
}
