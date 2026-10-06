import type { RailEntry } from '../ui/shellTypes'
import type { RailLayoutApi } from './useRailLayout'
import { useRailRecents } from './useRailRecents'
import { trackRecentOpens } from './trackRecentOpens'
import { isRailTool } from './railToolGroups'

/** Category launchers, explicit pins and recents share one live entry set. */
export function useRailTools(entryMap: ReadonlyMap<string, RailEntry>, layout: RailLayoutApi) {
  const availableIds = new Set([...entryMap.values()].filter(isRailTool).map((entry) => entry.id))
  const pinnedIds = new Set(
    [...layout.top, ...layout.bar, ...layout.bottom, ...layout.status].filter((id) => {
      const entry = entryMap.get(id)
      return entry && isRailTool(entry)
    }),
  )
  const recents = useRailRecents(availableIds, pinnedIds)
  const recentIds = new Set(recents.ids)
  const trackableIds = new Set(
    [...availableIds].filter((id) => !recentIds.has(id) && !pinnedIds.has(id)),
  )
  const launchableEntryMap = trackRecentOpens(entryMap, trackableIds, recents.touch)
  const toolEntries = [...launchableEntryMap.values()].filter(isRailTool)
  const pinTool = (id: string, pinned: boolean) =>
    layout.move(
      id,
      pinned ? 'bar' : 'overflow',
      pinned ? layout.bar.length : layout.overflow.length,
    )
  const unpinTool = (id: string) => pinTool(id, false)
  return { recents, recentIds, pinnedIds, launchableEntryMap, toolEntries, pinTool, unpinTool }
}
