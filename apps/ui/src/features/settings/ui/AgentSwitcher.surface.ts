import { defineContextualUiSurface } from '@localixai/mini-app-sdk/ui'

export default defineContextualUiSurface({
  id: 'context.settings.agent-switcher',
  title: 'Settings agent switcher',
  surface: 'picker',
  effect: 'read',
  exposure: {},
  reason:
    'Chooses whose rules the surrounding capability tabs read and write; opening it alone would address nothing.',
})
