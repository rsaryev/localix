import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.models.detail',
  title: 'Model detail panel',
  surface: 'work-item',
  effect: 'read',
  exposure: {},
  reason: 'Displays the model selected by its owning browser and has no standalone target.',
})
