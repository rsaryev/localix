import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.usage.localix',
  title: 'Localix usage',
  surface: 'work-item',
  effect: 'read',
  exposure: {},
  reason:
    'The Localix source panel inside Usage & Spend; its parent owns navigation and source selection.',
})
