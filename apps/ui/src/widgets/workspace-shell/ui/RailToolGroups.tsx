import type { ReactNode } from 'react'
import { PanelsTopLeft, Gamepad2, Wrench } from 'lucide-react'
import type { PluginCategory } from '@localixai/mini-app-sdk/manifest'
import { groupRailTools } from '../model/railToolGroups'
import { RailToolMenu } from './RailToolMenu'
import type { RailEntry } from './shellTypes'

interface RailToolGroupsProps {
  /** Only pinned tools in the middle rail zone, including defaults. */
  entries: readonly RailEntry[]
  categories?: ReadonlyMap<string, PluginCategory | undefined>
  renderEntry: (entry: RailEntry) => ReactNode
}

export function RailToolGroups({ entries, categories, renderEntry }: RailToolGroupsProps) {
  return groupRailTools(entries, categories).map((group) => {
    if (group.entries.length <= 2) return group.entries.map(renderEntry)
    const Icon = { workspace: PanelsTopLeft, tools: Wrench, games: Gamepad2 }[group.category]
    return (
      <RailToolMenu
        key={group.category}
        entries={group.entries}
        categories={categories}
        label={group.label}
        icon={<Icon />}
        category={group.category}
        active={group.entries.some((entry) => entry.active)}
      />
    )
  })
}
