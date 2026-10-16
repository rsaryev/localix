import type { ReactNode } from 'react'
import { Button } from '@localixai/kit/button'
import { Select } from '@localixai/kit/select'
import { SectionLabel } from '@localixai/kit/section-label'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { SETTINGS_SECTIONS } from '../model/settingsNavigation'

export interface SettingsNavigationItem {
  id: string
  label: string
  group: string
  description: string
}

/** Pane-width navigation: compact selector in a split, grouped rail in a wide workbench. */
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
  const groups = [...new Set(sections.map((section) => section.group))]
  const options = sections.map((section) => ({
    value: section.id,
    label: section.label,
    description: `${section.group} · ${section.description}`,
  }))
  return (
    <div className="shrink-0 border-b border-border-soft @4xl/settings:w-48 @4xl/settings:overflow-y-auto @4xl/settings:border-r @4xl/settings:border-b-0">
      <div className="space-y-3 p-4 @4xl/settings:p-3">
        <div className="@4xl/settings:hidden">
          <Select
            aria-label={pickerLabel}
            size="xl"
            className="w-full"
            value={active}
            options={options}
            onValueChange={onChange}
          />
        </div>
        {search}
        <nav aria-label={ariaLabel} className="hidden space-y-5 pt-2 @4xl/settings:block">
          {groups.map((group) => (
            <div key={group} role="group" aria-label={group} className="space-y-1">
              <SectionLabel className="px-2 pb-1">{group}</SectionLabel>
              {sections
                .filter((section) => section.group === group)
                .map((section) => (
                  <Button
                    key={section.id}
                    variant="ghost"
                    size="xl"
                    aria-current={active === section.id ? 'page' : undefined}
                    className={cn(
                      'w-full justify-start text-text-soft',
                      active === section.id && 'bg-surface-active text-foreground',
                    )}
                    onClick={() => onChange(section.id)}
                  >
                    {section.label}
                  </Button>
                ))}
            </div>
          ))}
        </nav>
      </div>
    </div>
  )
}
