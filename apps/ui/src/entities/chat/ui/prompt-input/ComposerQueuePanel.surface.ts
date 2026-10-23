import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.composer.queue',
  title: 'Composer queue panel',
  surface: 'work-item',
  effect: 'write',
  exposure: {},
  reason: 'Edits the active composer queue and cannot exist without its owning prompt input.',
})
