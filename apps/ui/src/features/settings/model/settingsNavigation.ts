import { isCapabilityTab, type SettingsTabId } from '@/shared/routing/routes'

/** Ordered by task: personal defaults, agent work, then application maintenance. */
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
    id: 'agents',
    label: 'Agents',
    group: 'Workspace',
    description: 'Reusable agent identities and profiles',
  },
  {
    id: 'tools',
    label: 'Capabilities',
    group: 'Workspace',
    description: 'Tools, skills, MCP, plugins and permission rules',
  },
  {
    id: 'project',
    label: 'Project',
    group: 'Workspace',
    description: 'Project name and shared instructions',
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
  return isCapabilityTab(tab) ? 'tools' : tab
}
