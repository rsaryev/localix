import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.browser.new-tab',
  title: 'New browser tab',
  surface: 'work-item',
  effect: 'read',
  exposure: {},
  reason: 'Shows the address field and recently visited URLs from the local Browser workspace.',
})
