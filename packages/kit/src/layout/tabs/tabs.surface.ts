import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.shared.tab-panel',
  title: 'Embedded tab panel',
  surface: 'work-item',
  effect: 'read',
  exposure: {},
  reason: 'A tab panel is owned and addressed by its containing workbench surface.',
})
