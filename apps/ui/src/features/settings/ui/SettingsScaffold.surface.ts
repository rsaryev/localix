import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.settings.scaffold',
  title: 'Settings page scaffold',
  surface: 'settings',
  effect: 'read',
  exposure: {},
  reason: 'Reusable layout rendered by a concrete settings page with its own route and content.',
})
