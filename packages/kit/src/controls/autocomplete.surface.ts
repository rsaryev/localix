import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.shared.autocomplete-panel',
  title: 'Embedded autocomplete panel',
  surface: 'work-item',
  effect: 'read',
  exposure: {},
  reason: 'An autocomplete panel is owned and addressed by its editable control.',
})
