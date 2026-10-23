/** The navigator's filter, sort and group vocabulary, and the menu that picks between them. */

import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { loadJSON } from '@localixai/mini-app-sdk/ui/storage'
import type { RequestInfo } from '../../backend/contracts'
import type { GroupMode, SortMode } from './sortRequests'

export function filterRequests(requests: RequestInfo[], filter: string): RequestInfo[] {
  const needle = filter.trim().toLowerCase()
  if (needle === '') return requests
  return requests.filter(
    (r) =>
      r.name.toLowerCase().includes(needle) ||
      r.spec.url.toLowerCase().includes(needle) ||
      r.spec.method.toLowerCase().includes(needle),
  )
}

export const SORT_MODES: readonly SortMode[] = ['name', 'method', 'recent']
export const GROUP_MODES: readonly GroupMode[] = ['folder', 'none', 'host', 'method']
export const SORT_LABELS: Record<SortMode, string> = {
  name: 'Name',
  method: 'Method',
  recent: 'Recent',
}
export const GROUP_LABELS: Record<GroupMode, string> = {
  folder: 'Folders',
  none: 'None',
  host: 'Host',
  method: 'Method',
}

/**
 * Sort and group as two `▸` rows, each naming its current pick.
 *
 * Two stacked radio groups put seven rows on screen to answer two questions, and the answers sat
 * as unlabelled dots inside them. A submenu per dimension shows both answers at a glance (`hint`),
 * and `keepOpen` steps a choice back to this level so the person sees the answer move.
 */
export function sortGroupEntries(
  sort: SortMode,
  setSort: (v: SortMode) => void,
  group: GroupMode,
  setGroup: (v: GroupMode) => void,
): MenuEntry[] {
  return [
    {
      id: 'sort',
      label: 'Sort by',
      hint: SORT_LABELS[sort],
      items: SORT_MODES.map((m) => ({
        id: `sort:${m}`,
        label: SORT_LABELS[m],
        selected: m === sort,
        keepOpen: true,
        onSelect: () => setSort(m),
      })),
    },
    {
      id: 'group',
      label: 'Group by',
      hint: GROUP_LABELS[group],
      items: GROUP_MODES.map((m) => ({
        id: `group:${m}`,
        label: GROUP_LABELS[m],
        selected: m === group,
        keepOpen: true,
        onSelect: () => setGroup(m),
      })),
    },
  ]
}

export function persisted<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = loadJSON<T>(key)
  return v && allowed.includes(v) ? v : fallback
}
