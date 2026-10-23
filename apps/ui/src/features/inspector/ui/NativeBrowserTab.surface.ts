import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.browser.native-tab',
  title: 'Native browser tab',
  surface: 'work-item',
  effect: 'read',
  exposure: {},
  reason: 'Requires a browser tab ID and an existing desktop WebView.',
})
