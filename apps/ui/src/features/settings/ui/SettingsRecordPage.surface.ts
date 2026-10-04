import { defineContextualUiSurface } from '@localixai/plugin-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.settings.record-page',
  title: 'Settings record form',
  surface: 'settings',
  effect: 'write',
  exposure: {},
  reason:
    'The shared frame a settings record is edited in; the record it holds is what has an address, not the frame.',
})
