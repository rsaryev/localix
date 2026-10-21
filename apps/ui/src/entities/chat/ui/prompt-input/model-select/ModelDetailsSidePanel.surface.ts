import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.models.details-side-panel',
  title: 'Model details side panel',
  surface: 'sidebar',
  effect: 'read',
  exposure: {},
  reason: 'A responsive detail region whose selected model is supplied by the parent picker.',
})
