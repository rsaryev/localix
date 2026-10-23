import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.editor-grid.settings-tab',
  title: 'Settings tab body',
  surface: 'work-item',
  effect: 'read',
  exposure: {},
  reason:
    'Internal editor-grid adapter rendered only for an existing settings work item and active scope.',
})
