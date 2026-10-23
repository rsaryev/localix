import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.mini-apps.view-tab',
  title: 'Mini app view tab renderer',
  surface: 'mini-app',
  effect: 'read',
  exposure: {},
  reason: 'Renders a runtime mini-app-view payload; each concrete view owns its generated URI.',
})
