import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.models.select-sidebar',
  title: 'Model selection sidebar',
  surface: 'sidebar',
  effect: 'write',
  exposure: {},
  reason: 'Selects a model for the owning prompt input rather than opening independently.',
})
