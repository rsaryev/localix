import { Settings } from 'lucide-react'
import { defineUiLocation } from '@localixai/plugin-sdk/ui'

export default defineUiLocation({
  id: 'settings.open',
  uri: 'localix://ui/settings/root',
  title: 'Settings',
  description: 'Open Localix settings',
  agent: {
    description:
      'Open Localix settings to configure preferences, tools, providers, plugins, and integrations.',
  },
  keywords: ['preferences', 'configuration', 'capabilities'],
  group: 'Application',
  Icon: Settings,
  effect: 'read',
  surface: 'settings',
  params: {
    scope: {
      type: 'string',
      description: 'Optional project scope id; omit it for global settings.',
      optional: true,
      allowEmpty: true,
      maxLength: 256,
    },
  },
  exposure: { search: true },
  resolve: ({ scope }) => ({
    kind: 'settings',
    tab: 'preferences',
    scope,
  }),
})
