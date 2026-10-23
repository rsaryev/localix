import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.routes.companion-page',
  title: 'Agent island page',
  surface: 'page',
  effect: 'read',
  exposure: {},
  reason: 'The desktop island window’s own route; it is opened by the native shell, not addressed.',
})
