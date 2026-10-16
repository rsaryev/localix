import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.external.history-container',
  title: 'External history container',
  surface: 'work-item',
  effect: 'read',
  exposure: {},
  reason: 'A resource-owned history view addressed by canonical external-agent container URIs.',
})
