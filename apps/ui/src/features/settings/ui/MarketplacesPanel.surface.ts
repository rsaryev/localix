import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.settings.marketplaces',
  title: 'Marketplaces settings panel',
  surface: 'settings',
  effect: 'write',
  exposure: {},
  reason: 'A section of plugin settings that manages the current marketplace configuration.',
})
