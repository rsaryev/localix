import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.composer.schedules',
  title: 'Schedules panel',
  surface: 'work-item',
  effect: 'write',
  exposure: {},
  reason: 'Configures loop state owned by the current chat composer.',
})
