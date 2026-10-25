import type { SettingsTabId } from '@/shared/routing/routes'

/** Ordered by task: personal defaults, agent work, security, then application maintenance. */
export const SETTINGS_SECTIONS = [
  {
    id: 'preferences',
    label: 'Preferences',
    group: 'Personal',
    description: 'Fonts, navigation, notifications and budget',
  },
  {
    id: 'editor',
    label: 'Editor',
    group: 'Personal',
    description: 'Editing, saving and code appearance',
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    group: 'Personal',
    description: 'Keyboard commands and chords',
  },
  {
    id: 'project',
    label: 'Project',
    group: 'Workspace',
    description: 'Project name and shared instructions',
  },
  {
    id: 'permissions',
    label: 'Permissions',
    group: 'Security',
    description: 'What agents may do: allow, ask and deny rules',
  },
  {
    id: 'models',
    label: 'Models',
    group: 'Application',
    description: "Models on this computer and the providers' model list",
  },
  {
    id: 'system',
    label: 'System',
    group: 'Application',
    description: 'Updates, storage, setup, access and diagnostics',
  },
] as const

export function primarySettingsSection(tab: SettingsTabId): string {
  if (typeof tab === 'object') return 'project'
  if (tab === 'diagnostics' || tab === 'context') return 'system'
  if (tab === 'model-list') return 'models'
  return tab
}
