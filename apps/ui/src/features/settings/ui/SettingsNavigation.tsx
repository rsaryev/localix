import type { ReactNode } from 'react'
import { TabBar } from '@localixai/kit/tabs'
import { SETTINGS_SECTIONS } from '../model/settingsNavigation'

export interface SettingsNavigationItem {
  id: string
  label: string
  group: string
  description: string
}

/**
 * The settings' sections above the page at every width: the search on its own row, then a strip
 * of tabs that scrolls sideways when they do not fit.
 */
export function SettingsNavigation({
  active,
  onChange,
  search,
  sections = SETTINGS_SECTIONS,
  'aria-label': ariaLabel = 'Settings sections',
}: {
  active: string
  onChange: (id: string) => void
  search?: ReactNode
  sections?: readonly SettingsNavigationItem[]
  'aria-label'?: string
}) {
  return (
    <div className="shrink-0">
      {search && <div className="px-4 pt-4 pb-2">{search}</div>}
      <TabBar
        aria-label={ariaLabel}
        items={sections.map(({ id, label }) => ({ id, label }))}
        active={active}
        onChange={onChange}
        className="px-2"
      />
    </div>
  )
}
