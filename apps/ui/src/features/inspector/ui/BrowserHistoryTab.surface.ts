import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.browser.history-tab',
  title: 'Browser history',
  surface: 'work-item',
  effect: 'read',
  exposure: {},
  reason: 'Shows visited URLs from the local Browser workspace.',
})
