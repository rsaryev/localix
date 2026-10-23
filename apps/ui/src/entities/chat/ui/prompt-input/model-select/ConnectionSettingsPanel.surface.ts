import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.models.connection-settings',
  title: 'Connection settings panel',
  surface: 'work-item',
  effect: 'write',
  exposure: {},
  reason: 'Edits the provider connection selected by the surrounding model browser.',
})
