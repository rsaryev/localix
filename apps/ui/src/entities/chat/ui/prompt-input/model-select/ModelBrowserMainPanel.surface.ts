import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.models.browser-main',
  title: 'Model browser main panel',
  surface: 'work-item',
  effect: 'read',
  exposure: {},
  reason:
    'Renders the model list and provider setup inside its owning browser; no standalone target.',
})
