import type { ReactNode } from 'react'
import { SidebarNav, type SidebarNavGroup } from '@localixai/kit/sidebar-nav'
import { SETTINGS_SECTIONS } from '../model/settingsNavigation'
import { useSettingsWide } from './SettingsWorkspace'

export interface SettingsNavigationItem {
  id: string
  label: string
  group: string
  description: string
}

/**
 * The settings' sections, as the kit's sidebar nav (the Store uses the same one): a grouped
 * column beside the page in a wide pane, one picker above it — the search beside it — in a split.
 */
export function SettingsNavigation({
  active,
  onChange,
  search,
  sections = SETTINGS_SECTIONS,
  'aria-label': ariaLabel = 'Settings sections',
  pickerLabel = 'Settings section',
}: {
  active: string
  onChange: (id: string) => void
  search?: ReactNode
  sections?: readonly SettingsNavigationItem[]
  'aria-label'?: string
  pickerLabel?: string
}) {
  const wide = useSettingsWide()
  const groups: SidebarNavGroup[] = [...new Set(sections.map((section) => section.group))].map(
    (group) => ({
      id: group,
      label: group,
      items: sections
        .filter((section) => section.group === group)
        .map(({ id, label, description }) => ({
          id,
          label,
          description: `${group} · ${description}`,
        })),
    }),
  )
  return wide ? (
    <div className="w-48 shrink-0 overflow-y-auto border-r border-border-soft p-3 pt-4">
      <SidebarNav
        mode="full"
        label={ariaLabel}
        groups={groups}
        active={active}
        onSelect={onChange}
        search={search}
      />
    </div>
  ) : (
    <div className="shrink-0 border-b border-border-soft p-4">
      <SidebarNav
        mode="select"
        label={pickerLabel}
        groups={groups}
        active={active}
        onSelect={onChange}
        search={search}
      />
    </div>
  )
}
