import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.models.local-connect',
  title: 'Local connection panel',
  surface: 'work-item',
  effect: 'write',
  exposure: {},
  reason: 'Connects the on-this-computer provider inside the model picker.',
})
