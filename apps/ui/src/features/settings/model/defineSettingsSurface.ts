import {
  defineUiLocation,
  type IconComponent,
  type UiLocationContribution,
} from '@localixai/mini-app-sdk/ui'
import { settingsUiUri } from '@localixai/mini-app-sdk/navigation'
import type { SettingsTabId } from '@/shared/routing/routes'

type StringSettingsTab = Exclude<SettingsTabId, { kind: 'project' }>

interface SettingsSurfaceDefinition {
  tab: StringSettingsTab
  title: string
  description: string
  keywords?: readonly string[]
  Icon?: IconComponent
}

const SETTINGS_SCOPE_PARAMS = {
  scope: {
    type: 'string',
    description: 'Optional project scope id; omit it for global settings.',
    optional: true,
    allowEmpty: true,
    maxLength: 256,
  },
} as const

/**
 * Define one exact Settings tab beside its owning component. The descriptor stays
 * lightweight and is discovered independently from the component's mount lifecycle.
 */
export function defineSettingsSurface({
  tab,
  title,
  description,
  keywords,
  Icon,
}: SettingsSurfaceDefinition): UiLocationContribution<typeof SETTINGS_SCOPE_PARAMS> {
  return defineUiLocation({
    id: `settings.${tab}.open`,
    uri: settingsUiUri(tab),
    title,
    description,
    agent: { description },
    keywords,
    group: 'Settings',
    Icon,
    effect: 'read',
    surface: 'settings',
    params: SETTINGS_SCOPE_PARAMS,
    exposure: { search: true },
    present: () => ({ label: `Open ${title}` }),
    resolve: ({ scope }) => ({
      kind: 'settings',
      tab,
      scope,
    }),
  })
}
