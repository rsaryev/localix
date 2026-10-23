import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.plugins.view-tab',
  title: 'Plugin view tab renderer',
  surface: 'plugin',
  effect: 'read',
  exposure: {},
  reason: 'Renders a runtime plugin-view payload; each concrete view owns its generated URI.',
})
