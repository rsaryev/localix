import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.usage.external',
  title: 'External usage',
  surface: 'work-item',
  effect: 'read',
  exposure: {},
  reason:
    'The External source panel inside Usage & Spend; its parent owns navigation and source selection.',
})
